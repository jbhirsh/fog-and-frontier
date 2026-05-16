import type { VercelRequest, VercelResponse } from '@vercel/node';

// Structured error logging for Vercel Observability. See issue #20.
//
// Goal: every 5xx from /api/* lands in Vercel logs as a single-line JSON object
// that's filterable by route/method/status, with enough context to debug.
//
// Never includes: req.body, Authorization header, env values. The Gemini API
// key only ever appears in outgoing Gemini URLs, which we don't log.
//
// Files in api/ that start with `_` are not exposed as routes by Vercel.

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

type LogContext = {
  route?: string;
  method?: string;
  status?: number;
  detail?: string;
};

function routeOf(req: VercelRequest): string {
  const url = typeof req.url === 'string' ? req.url : '';
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

type ErrSummary = {
  name: string;
  message: string;
  stack?: string;
  cause?: { name: string; message: string };
};

function summarize(err: unknown): ErrSummary {
  if (err instanceof Error) {
    const out: ErrSummary = {
      name: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 8).join('\n'),
    };
    // Node fetch puts the real diagnostic on err.cause — e.g. for ENOTFOUND
    // the top-level message is just "fetch failed", and the host appears as
    // `cause.message`. Walk one level so the JSON log carries useful signal.
    // No leak risk: cause.message for fetch failures is the hostname, never
    // the full URL with query string.
    if (err.cause instanceof Error) {
      out.cause = { name: err.cause.name, message: err.cause.message };
    }
    return out;
  }
  return { name: 'NonError', message: String(err) };
}

export function logServerError(err: unknown, ctx: LogContext = {}): void {
  const entry = {
    level: 'error',
    source: 'api',
    ts: new Date().toISOString(),
    ...ctx,
    err: summarize(err),
  };
  console.error(JSON.stringify(entry));
}

export function withErrorLogging(handler: Handler): Handler {
  return async function wrapped(req: VercelRequest, res: VercelResponse) {
    try {
      await handler(req, res);
    } catch (err) {
      logServerError(err, {
        route: routeOf(req),
        method: req.method,
        status: 500,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal server error' });
      }
    }
  };
}
