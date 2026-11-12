import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './smoke.mjs';

let log;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const BASE = 'https://preview.example';
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body, status = 200, type = 'text/html') =>
  new Response(body, { status, headers: { 'content-type': type } });

const activities = (n) => [
  { id: 'the-horse-park-at-woodside' },
  ...Array.from({ length: n - 1 }, (_, i) => ({ id: `a${i}` })),
];
const CSS = `/*! tailwindcss v4 */${'x'.repeat(1200)}`;

/**
 * A deployment answering each route: `catalog` for the catalog read, `trips`
 * for the anonymous trips read, `home` for GET /, `css` for the stylesheet.
 */
function deployment({
  catalog = () => json({ data: { activities: activities(64), completed: [{ id: 'x' }] } }),
  trips = () => json({ data: null, errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] }),
  home = () => text('<html><title>Fog</title><link href="/assets/app.css"></html>'),
  css = () => text(CSS, 200, 'text/css'),
} = {}) {
  return vi.fn(async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/api/graphql') {
      const { query } = JSON.parse(init.body);
      return query.includes('trips') ? trips() : catalog();
    }
    if (pathname === '/') return home();
    return css();
  });
}

const run = (fetch, env = {}) => main([BASE], { env, fetch });
const failed = () => log.mock.calls.map(([line]) => line).filter((l) => l.startsWith('[FAIL]'));

describe('main', () => {
  it('passes a healthy deployment: catalog floor, sentinel, trips refusal, HTML and CSS', async () => {
    const fetch = deployment();
    expect(await run(fetch)).toBe(0);
    expect(failed()).toEqual([]);
    expect(log).toHaveBeenCalledWith('\n6/6 checks passed');
    expect(log).toHaveBeenCalledWith(
      `Smoke gate against ${BASE} (SMOKE_ENV=Production (default), strict=true)`,
    );
    // Both GraphQL reads are sent as JSON.
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2);
    for (const [, init] of posts) {
      expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    }
  });

  it('takes its target from SMOKE_BASE_URL, and needs one', async () => {
    const fetch = deployment();
    expect(await main([], { env: { SMOKE_BASE_URL: BASE }, fetch })).toBe(0);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/api/graphql`);
    expect(await main([], { env: {}, fetch })).toBe(3);
  });

  it('sends the protection bypass as a header and in the URL', async () => {
    const fetch = deployment();
    await run(fetch, { VERCEL_AUTOMATION_BYPASS_SECRET: 's3cret' });
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get('x-vercel-protection-bypass')).toBe('s3cret');
    expect(new URL(url).searchParams.get('x-vercel-set-bypass-cookie')).toBe('true');
    expect(init.headers['x-vercel-protection-bypass']).toBe('s3cret');
  });

  it('calls a no-build stub (no CSS link, the API 404s) not built yet: 2', async () => {
    const fetch = deployment({
      catalog: () => text('not found', 404),
      trips: () => text('not found', 404),
      home: () => text('<html><title>stub</title></html>'),
    });
    expect(await run(fetch)).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[SMOKE_UNBUILT]'));
  });

  it('fails a real build whose catalog reads wrong: 1', async () => {
    const cases = [
      [() => json({ data: { activities: [], completed: [] } }), 'zero activities'],
      [
        () => json({ data: { activities: activities(3), completed: [] } }),
        'MIN_ACTIVITIES floor (64)',
      ],
      [
        () =>
          json({
            data: {
              activities: Array.from({ length: 64 }, (_, i) => ({ id: `a${i}` })),
              completed: [],
            },
          }),
        'sentinel "the-horse-park-at-woodside" missing',
      ],
      [() => json({ errors: [{ message: 'boom' }] }), 'GraphQL errors: boom'],
      [() => json({ data: { activities: {}, completed: [] } }), 'data.activities is not an array'],
      [() => json({ data: { activities: [], completed: null } }), 'data.completed is not an array'],
      [() => text('<html>', 200, 'text/html'), 'expected JSON, got text/html'],
      [() => text('{', 200, 'application/json'), 'body was not JSON'],
      [() => text('', 500), 'expected 200, got 500'],
      [() => Promise.reject(new Error('ECONNRESET')), 'request failed: ECONNRESET'],
      [() => Promise.reject('ECONNREFUSED'), 'request failed: ECONNREFUSED'],
      [() => json({}), 'data.activities is not an array'],
    ];
    for (const [catalog, detail] of cases) {
      log.mockClear();
      expect(await run(deployment({ catalog }))).toBe(1);
      expect(failed().join('\n')).toContain(detail);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[SMOKE_REGRESSION]'));
    // Only the checks that passed count as passed.
    expect(log.mock.calls.map(([line]) => line)).toContainEqual(
      expect.stringMatching(/^\n[0-5]\/\d+ checks passed$/),
    );
  });

  it('checks only the catalog shape off Production, and lets MIN_ACTIVITIES raise the floor', async () => {
    const few = deployment({ catalog: () => json({ data: { activities: [], completed: [] } }) });
    expect(await run(few, { SMOKE_ENV: 'Preview' })).toBe(0);
    expect(await run(deployment(), { MIN_ACTIVITIES: '100' })).toBe(1);
    expect(failed().join('\n')).toContain('64 activities < MIN_ACTIVITIES floor (100)');
  });

  it("fails an anonymous trips read that isn't refused, or won't parse", async () => {
    const leaked = deployment({ trips: () => json({ data: { trips: [{ id: 't' }] } }) });
    expect(await run(leaked)).toBe(1);
    expect(failed().join('\n')).toContain('anonymous caller got trip data back');
    log.mockClear();
    expect(await run(deployment({ trips: () => text('{', 200, 'application/json') }))).toBe(1);
    expect(failed().join('\n')).toContain('body was not JSON');
    log.mockClear();
    expect(await run(deployment({ trips: () => text('<html>', 200) }))).toBe(1);
    expect(failed().join('\n')).toContain('expected JSON, got text/html');
    log.mockClear();
    expect(await run(deployment({ trips: () => Promise.reject(new Error('reset')) }))).toBe(1);
    expect(failed().join('\n')).toContain('request failed: reset');
  });

  it('fails a page or stylesheet that looks unbuilt or broken', async () => {
    const cases = [
      [{ home: () => text('', 503) }, 'GET / — expected 200, got 503'],
      [{ home: () => Promise.reject(new Error('down')) }, 'GET / — request failed: down'],
      [{ home: () => text('<html></html>') }, 'HTML missing <title>'],
      [{ home: () => text('<title>x</title>') }, 'no /assets/*.css link in HTML'],
      [{ css: () => text('', 404) }, 'GET CSS asset — expected 200, got 404'],
      [{ css: () => text('tiny') }, 'CSS suspiciously small (4 bytes)'],
      [{ css: () => text('x'.repeat(1200)) }, 'CSS missing Tailwind banner'],
      [{ css: () => Promise.reject(new Error('gone')) }, 'GET CSS asset — request failed: gone'],
    ];
    for (const [routes, detail] of cases) {
      log.mockClear();
      expect(await run(deployment(routes))).toBe(1);
      expect(failed().join('\n')).toContain(detail);
    }
  });

  it('gives up on a request after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const hang = vi.fn(
        (_url, init) =>
          new Promise((_, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
      const done = run(hang);
      await vi.advanceTimersByTimeAsync(15_000 * 4);
      expect(await done).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(failed().join('\n')).toContain('request failed: aborted');
  });
});
