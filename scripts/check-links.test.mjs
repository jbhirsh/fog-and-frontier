import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAll, failure, fetchCatalog, main, probe } from './check-links.mjs';
import { HOST_STRIKES } from './link-check.mjs';

afterEach(() => vi.restoreAllMocks());

/** A response as fetch gives one, with the URL it ended at. */
function response(body, { status = 200, type = 'text/html', url = '', headers = {} } = {}) {
  const res = new Response(body, { status, headers: { 'content-type': type, ...headers } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

/** A network whose fetch answers by URL, and whose sleep only counts. */
function fakeNet(answer) {
  const slept = [];
  return {
    slept,
    fetch: vi.fn(async (url, init) => answer(String(url), init)),
    sleep: vi.fn(async (ms) => void slept.push(ms)),
  };
}

const catalog = (activities) =>
  response(JSON.stringify({ data: { activities } }), { type: 'application/json' });

describe('fetchCatalog', () => {
  it('reads the activities through the public GraphQL query', async () => {
    const net = fakeNet(() => catalog([{ id: 'a', name: 'A' }]));
    expect(await fetchCatalog('https://example.com', net)).toEqual([{ id: 'a', name: 'A' }]);
    const [url, init] = net.fetch.mock.calls[0];
    expect(String(url)).toBe('https://example.com/api/graphql');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).query).toMatch(/^\{ activities \{ id name /);
  });

  it("says why the catalog couldn't be read", async () => {
    const errors = fakeNet(() =>
      response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 500 }),
    );
    await expect(fetchCatalog('https://x.dev', errors)).rejects.toThrow(
      'catalog read failed: HTTP 500: boom',
    );
    const html = fakeNet(() => response('<html>gateway</html>', { status: 502 }));
    await expect(fetchCatalog('https://x.dev', html)).rejects.toThrow(
      'catalog read failed: HTTP 502: <html>gateway</html>',
    );
  });
});

describe('failure', () => {
  it('names a timeout, else the most specific reason undici gives', () => {
    expect(failure(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toEqual({
      error: 'timeout',
    });
    expect(failure({ cause: { code: 'ENOTFOUND', message: 'm' } })).toEqual({ error: 'ENOTFOUND' });
    expect(failure({ cause: { message: 'redirect count exceeded' } })).toEqual({
      error: 'redirect count exceeded',
    });
    expect(failure({ code: 'ECONNRESET' })).toEqual({ error: 'ECONNRESET' });
    expect(failure(new Error('fetch failed badly'))).toEqual({ error: 'fetch failed badly' });
    expect(failure(undefined)).toEqual({ error: 'fetch failed' });
  });
});

describe('probe', () => {
  it("reports a page's status, type and where it ended up", async () => {
    const net = fakeNet(() => response('ok', { url: 'https://example.com/final' }));
    expect(await probe('https://example.com/start', net)).toEqual({
      status: 200,
      contentType: 'text/html',
      finalUrl: 'https://example.com/final',
    });
    expect(net.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'follow' });
  });

  it("retries a 429 after the host's Retry-After, then gives up as rate limited", async () => {
    const net = fakeNet(() => response('', { status: 429, headers: { 'retry-after': '2' } }));
    expect(await probe('https://example.com/a', net)).toMatchObject({ status: 429 });
    expect(net.fetch).toHaveBeenCalledTimes(3);
    expect(net.slept).toEqual([2000, 2000]);
  });

  it('reads an Instagram post through its embed page', async () => {
    const up = fakeNet(() => response('"contextJSON":"{\\"shortcode_media\\":{}}"'));
    const result = await probe('https://www.instagram.com/p/ABCDE12345/', up);
    expect(String(up.fetch.mock.calls[0][0])).toBe(
      'https://www.instagram.com/p/ABCDE12345/embed/captioned/',
    );
    expect(result).toMatchObject({ status: 200, post: true });
    const gone = fakeNet(() => response('', { status: 404 }));
    expect(await probe('https://instagram.com/reel/ABCDE12345', gone)).toEqual({
      status: 404,
      contentType: 'text/html',
      finalUrl: '',
    });
    const down = fakeNet(() =>
      Promise.reject(Object.assign(new Error(), { name: 'TimeoutError' })),
    );
    expect(await probe('https://instagram.com/p/ABCDE12345', down)).toEqual({ error: 'timeout' });
  });

  it('reports a request that failed', async () => {
    const net = fakeNet(() => Promise.reject({ cause: { code: 'ENOTFOUND' } }));
    expect(await probe('https://gone.example', net)).toEqual({ error: 'ENOTFOUND' });
  });
});

describe('checkAll', () => {
  const link = (name, url, field = 'menuUrl') => ({ id: name, name, field, url, image: false });

  it('judges every link, paced per host, sorted by place and field', async () => {
    const net = fakeNet((url) => response('', { status: url.endsWith('/gone') ? 404 : 200 }));
    const results = await checkAll(
      [
        link('Zed', 'https://a.example/ok'),
        link('Abe', 'https://a.example/gone'),
        link('Abe', 'https://b.example/ok', 'allTrailsUrl'),
        link('Bad', 'not a url'),
      ],
      net,
    );
    expect(results.map((r) => [r.name, r.field, r.verdict])).toEqual([
      ['Abe', 'allTrailsUrl', 'ok'],
      ['Abe', 'menuUrl', 'dead'],
      ['Bad', 'menuUrl', 'dead'],
      ['Zed', 'menuUrl', 'ok'],
    ]);
    // One gap between a.example's two links; none for a host's first.
    expect(net.slept).toEqual([750]);
  });

  it('stops probing a host that keeps refusing, and sends the rest to review', async () => {
    const net = fakeNet(() => Promise.reject(Object.assign(new Error(), { name: 'TimeoutError' })));
    const links = Array.from({ length: HOST_STRIKES + 2 }, (_, i) =>
      link(`P${i}`, `https://slow.example/${i}`),
    );
    const results = await checkAll(links, net);
    expect(net.fetch).toHaveBeenCalledTimes(HOST_STRIKES);
    expect(results.every((r) => r.verdict === 'review')).toBe(true);
  });
});

describe('main', () => {
  const answer = (url) =>
    url.endsWith('/api/graphql')
      ? catalog([{ id: 'a', name: 'A', menuUrl: 'https://a.example/menu' }])
      : response('', { status: url.includes('gone') ? 404 : 200 });

  it('prints the report, writes it where LINKS_REPORT says, and exits 0 with nothing dead', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'links-')), 'report.md');
    const write = vi.fn();
    const net = fakeNet(answer);
    expect(await main([], { env: { LINKS_REPORT: out }, net, write })).toBe(0);
    expect(String(net.fetch.mock.calls[0][0])).toBe(
      'https://fog-and-frontier.vercel.app/api/graphql',
    );
    expect(write.mock.calls[0][0]).toContain('# Link audit');
    expect(readFileSync(out, 'utf8')).toBe(write.mock.calls[0][0]);
  });

  it('checks the site given, or LINKS_BASE_URL, and exits 1 when a link is dead', async () => {
    const dead = (url) =>
      url.endsWith('/api/graphql')
        ? catalog([{ id: 'a', name: 'A', menuUrl: 'https://a.example/gone' }])
        : answer(url);
    const net = fakeNet(dead);
    expect(await main(['https://preview.example'], { env: {}, net, write: vi.fn() })).toBe(1);
    expect(String(net.fetch.mock.calls[0][0])).toBe('https://preview.example/api/graphql');
    const fromEnv = fakeNet(answer);
    await main([], {
      env: { LINKS_BASE_URL: 'https://env.example' },
      net: fromEnv,
      write: vi.fn(),
    });
    expect(String(fromEnv.fetch.mock.calls[0][0])).toBe('https://env.example/api/graphql');
  });

  it('uses the real fetch, pacing and stdout by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).endsWith('/api/graphql')
          ? catalog([
              {
                id: 'a',
                name: 'A',
                menuUrl: 'https://a.example/1',
                sourceUrl: 'https://a.example/2',
              },
            ])
          : response(''),
      ),
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await main([], { env: {} })).toBe(0);
    } finally {
      // Back to src/test/setup.ts's offline fetch, for the tests after this.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    }
    expect(stdout.mock.calls[0][0]).toContain('# Link audit');
  });
});
