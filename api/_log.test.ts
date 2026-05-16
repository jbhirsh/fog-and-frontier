import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logServerError, withErrorLogging } from './_log.js';

function fakeReq(opts: Partial<VercelRequest> = {}): VercelRequest {
  return {
    url: '/api/discover',
    method: 'POST',
    headers: { authorization: 'Bearer secret-token-xyz' },
    ...opts,
  } as unknown as VercelRequest;
}

type CapturingRes = VercelResponse & {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
};

function fakeRes(): CapturingRes {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res as unknown as CapturingRes;
}

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

describe('withErrorLogging', () => {
  let cap: ReturnType<typeof captureConsoleError>;

  beforeEach(() => {
    cap = captureConsoleError();
  });

  afterEach(() => {
    cap.restore();
  });

  it('passes through successful responses without logging', async () => {
    const wrapped = withErrorLogging((_req, res) => {
      res.status(200).json({ ok: true });
    });
    const res = fakeRes();
    await wrapped(fakeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(cap.lines).toHaveLength(0);
  });

  it('catches throws, logs a structured error, and returns 500', async () => {
    const wrapped = withErrorLogging(() => {
      throw new Error('db unreachable');
    });
    const res = fakeRes();
    await wrapped(fakeReq({ url: '/api/activities?id=foo', method: 'GET' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'internal server error' });
    expect(cap.lines).toHaveLength(1);
    const parsed = JSON.parse(cap.lines[0] ?? '') as {
      route: string;
      method: string;
      status: number;
      err: { message: string };
    };
    // Query string is stripped from the logged route — keeps logs clean.
    expect(parsed.route).toBe('/api/activities');
    expect(parsed.method).toBe('GET');
    expect(parsed.status).toBe(500);
    expect(parsed.err.message).toBe('db unreachable');
  });

  it('never logs the Authorization header or request body', async () => {
    const wrapped = withErrorLogging(() => {
      throw new Error('boom');
    });
    const req = fakeReq();
    (req as { body?: unknown }).body = { secret: 'do-not-log-me' };
    const res = fakeRes();
    await wrapped(req, res);
    expect(cap.lines[0]).not.toContain('secret-token-xyz'); // Authorization
    expect(cap.lines[0]).not.toContain('do-not-log-me'); // body
  });

  it('does not double-respond if the handler already responded before throwing', async () => {
    const wrapped = withErrorLogging((_req, res) => {
      res.status(200).json({ partial: true });
      throw new Error('boom after response');
    });
    const res = fakeRes();
    await wrapped(fakeReq(), res);
    // Original 200 stands; logger doesn't overwrite headers.
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ partial: true });
    expect(cap.lines).toHaveLength(1);
  });
});
