// The judges' verdicts and the judge call's retry rules, with Gemini answered
// by a fake fetch. The schema checks, envelope parsing and event lines are
// tested in judge.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { judgeDescriptions, judgeDiscoverEvents, judgeRealPlace } from './judge.js';

/** A Gemini reply holding `verdict` as its JSON text. */
const reply = (verdict: unknown) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }] });

/** Gemini answering each call in turn with the next of `answers`. */
function gemini(...answers: (Response | Error | Record<string, unknown>)[]) {
  const fetch = vi.fn(() => {
    const next = answers.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => vi.stubEnv('GEMINI_API_KEY', 'test-key'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // Back to src/test/setup.ts's offline fetch, for the tests after these.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

const activity = { activity: { name: 'Muir Woods', lat: 37.9, lng: -122.6 } };

describe('the judge call', () => {
  it('gives up at once without a key, or on a request Gemini refuses', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect((await judgeDescriptions(activity, 'facts')).detail).toBe(
      'judge call failed: GEMINI_API_KEY not configured',
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetch = gemini(new Response('', { status: 403 }));
    expect(await judgeDescriptions(activity, 'facts')).toEqual({
      name: 'judge:descriptions',
      status: 'error',
      detail: 'judge call failed: HTTP 403',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a rate limit or a server error once, then reports it', async () => {
    gemini(new Response('', { status: 429 }), reply({ pass: true, issues: [] }));
    expect((await judgeDescriptions(activity, 'facts')).status).toBe('pass');
    gemini(new Response('', { status: 500 }), new Response('', { status: 503 }));
    expect((await judgeDescriptions(activity, 'facts')).detail).toBe(
      'judge call failed twice: HTTP 503',
    );
  });

  it("retries an answer it can't read, never passing one", async () => {
    const cases = [
      Response.json({ candidates: [] }),
      new Response('not json', { status: 200 }),
      Response.json({ candidates: [{ content: { parts: [{ text: '{' }] } }] }),
      reply({ pass: 'yes', issues: [] }),
    ];
    for (const bad of cases) {
      gemini(bad, bad.clone());
      expect((await judgeDescriptions(activity, 'facts')).detail).toBe(
        'judge call failed twice: malformed judge response',
      );
    }
  });

  it('names a timeout and a network error without the request or its key', async () => {
    gemini(Object.assign(new Error('aborted'), { name: 'AbortError' }), new Error('reset'));
    const result = await judgeDescriptions(activity, 'facts');
    expect(result.detail).toBe('judge call failed twice: network error');
    gemini(
      new Error('reset'),
      Object.assign(new Error('aborted test-key'), { name: 'AbortError' }),
    );
    const timedOut = await judgeDescriptions(activity, 'facts');
    expect(timedOut.detail).toBe('judge call failed twice: request timed out');
    expect(timedOut.detail).not.toContain('test-key');
  });

  it('aborts a call that runs past its time limit', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_, reject) =>
              init.signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              ),
            ),
        ),
      );
      const result = judgeDescriptions(activity, 'facts');
      await vi.advanceTimersByTimeAsync(240_000);
      expect((await result).detail).toBe('judge call failed twice: request timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('judgeDescriptions', () => {
  it("fails prose the judge finds wrong, with its issues, and passes what's plausible", async () => {
    gemini(reply({ pass: false, issues: ['wrong county', 'no such trail'] }));
    expect(await judgeDescriptions(activity, 'facts')).toEqual({
      name: 'judge:descriptions',
      status: 'fail',
      detail: 'wrong county; no such trail',
    });
    gemini(reply({ pass: true, issues: [] }));
    expect((await judgeDescriptions(activity, 'facts')).detail).toBe('plausible');
  });

  it('errors on output with no activity in it', async () => {
    expect(await judgeDescriptions({ events: [] }, 'facts')).toMatchObject({
      status: 'error',
      detail: 'no activity in resolver output',
    });
  });
});

describe('judgeRealPlace', () => {
  const verdict = (isRealPlace: boolean, coordsConsistent: boolean, issues: string[] = []) =>
    reply({ isRealPlace, coordsConsistent, issues });

  it('passes a real place at its coordinates, and says why otherwise', async () => {
    gemini(verdict(true, true));
    expect(await judgeRealPlace(activity)).toEqual({
      name: 'judge:real-place',
      status: 'pass',
      detail: 'real place, coordinates consistent',
    });
    gemini(verdict(false, false));
    expect(await judgeRealPlace(activity)).toMatchObject({
      status: 'fail',
      detail: 'not a verifiable real place; coordinates inconsistent with the named place',
    });
    gemini(verdict(true, false));
    expect((await judgeRealPlace(activity)).detail).toBe(
      'coordinates inconsistent with the named place',
    );
    gemini(verdict(false, true, ['invented name']));
    expect((await judgeRealPlace(activity)).detail).toBe('invented name');
  });

  it('errors on output with no activity, or a judge that fails', async () => {
    expect((await judgeRealPlace(null)).detail).toBe('no activity in resolver output');
    gemini(new Response('', { status: 400 }));
    expect(await judgeRealPlace(activity)).toMatchObject({
      status: 'error',
      detail: 'judge call failed: HTTP 400',
    });
  });
});

describe('judgeDiscoverEvents', () => {
  const events = { events: [{ name: 'Market' }, { name: 'Run' }, { name: 'Show' }] };

  it("passes when enough are plausible, and lists the rest's issues when not", async () => {
    gemini(
      reply({
        verdicts: [
          { index: 0, plausible: true, issues: [] },
          { index: 1, plausible: false, issues: ['generic', 'no venue'] },
          { index: 2, plausible: false, issues: [] },
        ],
      }),
    );
    expect(await judgeDiscoverEvents(events, 0.5)).toEqual({
      name: 'judge:events',
      status: 'fail',
      detail: '1/3 plausible (0.33, need 0.50); [1] generic, no venue; [2] implausible',
    });
    gemini(
      reply({
        verdicts: [
          { index: 0, plausible: true, issues: [] },
          { index: 1, plausible: true, issues: [] },
        ],
      }),
    );
    expect(await judgeDiscoverEvents(events, 0.6)).toEqual({
      name: 'judge:events',
      status: 'pass',
      detail: '2/3 plausible (0.67, need 0.60)',
    });
  });

  it("counts an event the judge left out as implausible, and grounds it in today's date", async () => {
    const fetch = gemini(reply({ verdicts: [{ index: 0, plausible: true, issues: [] }] }));
    const result = await judgeDiscoverEvents({ events: [{ name: 'A' }, { name: 'B' }] }, 1);
    expect(result.detail).toContain('[1] no verdict returned');
    const body = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    ) as {
      contents: { parts: { text: string }[] }[];
    };
    expect(body.contents[0].parts[0].text).toMatch(/^Today is \w+day, /);
  });

  it('errors with no events array, passes none, and errors when the judge fails', async () => {
    expect((await judgeDiscoverEvents({}, 0.5)).detail).toBe('no events array in resolver output');
    expect(await judgeDiscoverEvents({ events: [] }, 0.5)).toMatchObject({
      status: 'pass',
      detail: 'no events to judge',
    });
    gemini(new Response('', { status: 401 }));
    expect((await judgeDiscoverEvents(events, 0.5)).status).toBe('error');
  });
});
