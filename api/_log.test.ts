import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logServerError } from './_log.js';

// Type-safe shim: capture console.error calls into a string[] we own,
// instead of poking at `vi.spyOn(...).mock.calls` which lints as `any`.
function captureConsoleError(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  return {
    lines,
    restore: () => {
      console.error = original;
    },
  };
}

describe('logServerError', () => {
  let cap: ReturnType<typeof captureConsoleError>;

  beforeEach(() => {
    cap = captureConsoleError();
  });

  afterEach(() => {
    cap.restore();
  });

  it('emits a single-line JSON entry with route/method/status/err', () => {
    logServerError(new Error('boom'), {
      route: '/api/discover',
      method: 'POST',
      status: 502,
    });
    expect(cap.lines).toHaveLength(1);
    const line = cap.lines[0] ?? '';
    expect(line).not.toContain('\n'); // single-line
    const parsed = JSON.parse(line) as {
      level: string;
      source: string;
      route: string;
      method: string;
      status: number;
      err: { name: string; message: string; stack?: string };
    };
    expect(parsed.level).toBe('error');
    expect(parsed.source).toBe('api');
    expect(parsed.route).toBe('/api/discover');
    expect(parsed.method).toBe('POST');
    expect(parsed.status).toBe(502);
    expect(parsed.err.name).toBe('Error');
    expect(parsed.err.message).toBe('boom');
    expect(typeof parsed.err.stack).toBe('string');
  });

  it('keeps the stack to its first 8 lines, as a string', () => {
    const err = new Error('deep');
    const frames = Array.from({ length: 12 }, (_, i) => `    at frame${i} (file.ts:${i}:1)`);
    err.stack = ['Error: deep', ...frames].join('\n');
    logServerError(err);
    const parsed = JSON.parse(cap.lines[0] ?? '') as { err: { stack?: unknown } };
    expect(parsed.err.stack).toBe(['Error: deep', ...frames.slice(0, 7)].join('\n'));
  });

  it('logs an Error that has no stack without throwing', () => {
    const err = new Error('stackless');
    delete err.stack;
    expect(() => logServerError(err)).not.toThrow();
    const parsed = JSON.parse(cap.lines[0] ?? '') as {
      err: { name: string; message: string; stack?: unknown };
    };
    expect(parsed.err).toEqual({ name: 'Error', message: 'stackless' });
  });

  it('handles non-Error throws', () => {
    logServerError('plain string failure');
    const parsed = JSON.parse(cap.lines[0] ?? '') as {
      err: { name: string; message: string };
    };
    expect(parsed.err.name).toBe('NonError');
    expect(parsed.err.message).toBe('plain string failure');
  });

  it('walks err.cause one level so Node fetch failures surface their hostname', () => {
    // Reproduces the Node fetch shape: top-level "fetch failed" + cause carrying
    // the actual ENOTFOUND / ECONNREFUSED diagnostic.
    const inner = new Error('getaddrinfo ENOTFOUND turso.example.invalid');
    inner.name = 'TypeError';
    const wrapped = new Error('fetch failed', { cause: inner });
    logServerError(wrapped, { route: '/api/activities', method: 'GET', status: 500 });
    const parsed = JSON.parse(cap.lines[0] ?? '') as {
      err: { message: string; cause?: { name: string; message: string } };
    };
    expect(parsed.err.message).toBe('fetch failed');
    expect(parsed.err.cause?.name).toBe('TypeError');
    expect(parsed.err.cause?.message).toBe(
      'getaddrinfo ENOTFOUND turso.example.invalid',
    );
  });

  it('omits cause when it is not an Error (e.g. plain object)', () => {
    const err = new Error('boom');
    (err as { cause?: unknown }).cause = { code: 'whatever' };
    logServerError(err);
    const parsed = JSON.parse(cap.lines[0] ?? '') as { err: { cause?: unknown } };
    expect(parsed.err.cause).toBeUndefined();
  });

  it('never leaks the Gemini API key value if it lives in env', () => {
    // The current code never logs the outgoing Gemini URL, but if it ever
    // started doing so by accident, this test would catch the obvious case.
    vi.stubEnv('GEMINI_API_KEY', 'AIzaSy-fake-test-key-do-not-use');
    logServerError(new Error('gemini request failed: 500'), {
      route: '/api/discover',
      method: 'POST',
      status: 502,
      detail: 'rate limited',
    });
    expect(cap.lines[0]).not.toContain('AIzaSy-fake-test-key-do-not-use');
    vi.unstubAllEnvs();
  });
});
