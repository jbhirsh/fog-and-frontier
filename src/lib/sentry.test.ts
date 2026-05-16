import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breadcrumb, ErrorEvent, Exception } from '@sentry/react';
import type { TransactionEvent } from '@sentry/core';

const { init, reactRouterV7BrowserTracingIntegration } = vi.hoisted(() => ({
  init: vi.fn(),
  reactRouterV7BrowserTracingIntegration: vi.fn<
    (options: Record<string, unknown>) => { name: string }
  >(() => ({ name: 'ReactRouterV7BrowserTracing' })),
}));

vi.mock('@sentry/react', async () => {
  const actual = await vi.importActual<typeof import('@sentry/react')>(
    '@sentry/react',
  );
  return { ...actual, init, reactRouterV7BrowserTracingIntegration };
});

const {
  initSentry,
  scrubBreadcrumb,
  scrubEmbeddedQueries,
  scrubEvent,
  scrubTransaction,
  stripQueryString,
} = await import('./sentry');

describe('stripQueryString', () => {
  it('removes everything after the first ?', () => {
    expect(stripQueryString('https://api.example.com/x?a=1&b=2')).toBe(
      'https://api.example.com/x',
    );
  });

  it('leaves URLs without a query string untouched', () => {
    expect(stripQueryString('https://api.example.com/x')).toBe(
      'https://api.example.com/x',
    );
  });

  it('strips the Gemini-style key=... query', () => {
    // Defense-in-depth: this URL shape never reaches the browser, but if it
    // ever does (e.g. via a stack trace) we must not capture it.
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSy-fake-test-key';
    expect(stripQueryString(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(stripQueryString(url)).not.toContain('AIzaSy-fake-test-key');
  });
});

describe('scrubBreadcrumb', () => {
  it('strips query string from data.url', () => {
    const crumb: Breadcrumb = {
      category: 'fetch',
      data: { url: 'https://api.example.com/x?token=abc', method: 'GET' },
    };
    const out = scrubBreadcrumb(crumb);
    expect((out.data as { url: string }).url).toBe('https://api.example.com/x');
    expect((out.data as { method: string }).method).toBe('GET');
  });

  it('returns the breadcrumb untouched when there is no query string', () => {
    const crumb: Breadcrumb = {
      category: 'fetch',
      data: { url: 'https://api.example.com/x', method: 'GET' },
    };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });

  it('returns the breadcrumb untouched when there is no url field', () => {
    const crumb: Breadcrumb = { category: 'console', message: 'hello' };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });
});

describe('initSentry', () => {
  beforeEach(() => {
    init.mockClear();
    reactRouterV7BrowserTracingIntegration.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when VITE_SENTRY_DSN is unset', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    initSentry();
    expect(init).not.toHaveBeenCalled();
  });

  it('initialises Sentry with the DSN and our scrubbers when configured', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
    vi.stubEnv('VITE_VERCEL_ENV', 'production');
    vi.stubEnv('VITE_VERCEL_GIT_COMMIT_SHA', 'abc123');
    initSentry();
    expect(init).toHaveBeenCalledTimes(1);
    const call = init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.dsn).toBe('https://public@o0.ingest.sentry.io/0');
    expect(call.environment).toBe('production');
    expect(call.release).toBe('abc123');
    expect(call.sendDefaultPii).toBe(false);
    expect(call.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(call.beforeSend).toBe(scrubEvent);
    expect(call.beforeSendTransaction).toBe(scrubTransaction);
    expect(call.tracePropagationTargets).toEqual([/^\//]);
  });

  it('samples 10% of transactions in production', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
    vi.stubEnv('VITE_VERCEL_ENV', 'production');
    initSentry();
    const call = init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.tracesSampleRate).toBe(0.1);
  });

  it('samples 100% of transactions outside production', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
    vi.stubEnv('VITE_VERCEL_ENV', 'preview');
    initSentry();
    const call = init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.tracesSampleRate).toBe(1.0);
  });

  it('registers the React Router v7 browser-tracing integration with the required hooks', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
    initSentry();
    expect(reactRouterV7BrowserTracingIntegration).toHaveBeenCalledTimes(1);
    const callArgs = reactRouterV7BrowserTracingIntegration.mock.calls[0];
    const opts = callArgs?.[0] ?? {};
    expect(typeof opts.useEffect).toBe('function');
    expect(typeof opts.useLocation).toBe('function');
    expect(typeof opts.useNavigationType).toBe('function');
    expect(typeof opts.createRoutesFromChildren).toBe('function');
    expect(typeof opts.matchRoutes).toBe('function');
    const call = init.mock.calls[0]?.[0] as { integrations: unknown[] };
    expect(call.integrations).toHaveLength(1);
  });
});

describe('scrubEmbeddedQueries', () => {
  it('strips ?... from an embedded URL inside a longer string', () => {
    const msg =
      'fetch failed at https://generativelanguage.googleapis.com/v1beta/x?key=AIzaSy-fake (status 401)';
    expect(scrubEmbeddedQueries(msg)).toBe(
      'fetch failed at https://generativelanguage.googleapis.com/v1beta/x (status 401)',
    );
    expect(scrubEmbeddedQueries(msg)).not.toContain('AIzaSy-fake');
  });

  it('strips multiple embedded query strings', () => {
    expect(
      scrubEmbeddedQueries('a https://x.test/?a=1 b https://y.test/?b=2 c'),
    ).toBe('a https://x.test/ b https://y.test/ c');
  });

  it('leaves text without `?` untouched', () => {
    expect(scrubEmbeddedQueries('nothing to scrub here')).toBe(
      'nothing to scrub here',
    );
  });
});

describe('scrubEvent', () => {
  it('strips query string from event.request.url', () => {
    const event = {
      request: { url: 'https://app.example.com/page?session=secret' },
    } as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.request?.url).toBe('https://app.example.com/page');
  });

  it('strips query strings from exception.values[].value', () => {
    const exc: Exception = {
      type: 'Error',
      value: 'fetch failed at https://api.example.com/x?token=secret&id=42',
    };
    const event = { exception: { values: [exc] } } as ErrorEvent;
    const out = scrubEvent(event);
    const value = out.exception?.values?.[0]?.value;
    expect(value).toBe('fetch failed at https://api.example.com/x');
    expect(value).not.toContain('secret');
  });

  it('leaves exception.values[].value alone when no query string', () => {
    const exc: Exception = { type: 'Error', value: 'no urls here' };
    const event = { exception: { values: [exc] } } as ErrorEvent;
    expect(scrubEvent(event)).toBe(event);
  });

  it('returns the event untouched when there is no query string anywhere', () => {
    const event = {
      request: { url: 'https://app.example.com/page' },
    } as ErrorEvent;
    expect(scrubEvent(event)).toBe(event);
  });

  it('returns the event untouched when there is no request', () => {
    const event = {} as ErrorEvent;
    expect(scrubEvent(event)).toBe(event);
  });
});

describe('scrubTransaction', () => {
  it('strips query strings from URL-shaped span data keys', () => {
    const event = {
      type: 'transaction',
      spans: [
        {
          data: {
            'http.url': 'https://api.example.com/x?token=secret',
            'http.method': 'GET',
          },
        },
        {
          data: {
            url: 'https://other.example.com/y?session=abc',
            note: 'no scrub on this field',
          },
        },
      ],
    } as unknown as TransactionEvent;
    const out = scrubTransaction(event);
    const span0 = out.spans?.[0]?.data as Record<string, unknown> | undefined;
    const span1 = out.spans?.[1]?.data as Record<string, unknown> | undefined;
    expect(span0?.['http.url']).toBe('https://api.example.com/x');
    expect(span0?.['http.method']).toBe('GET'); // untouched
    expect(span1?.url).toBe('https://other.example.com/y');
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(JSON.stringify(out)).not.toContain('session=abc');
  });

  it('strips query strings from the root trace context data', () => {
    const event = {
      type: 'transaction',
      contexts: {
        trace: { data: { 'http.url': 'https://app.example.com/?session=x' } },
      },
    } as unknown as TransactionEvent;
    const out = scrubTransaction(event);
    const data = out.contexts?.trace?.data;
    expect(data?.['http.url']).toBe('https://app.example.com/');
  });

  it('returns the event untouched when no span data contains a query string', () => {
    const event = {
      type: 'transaction',
      spans: [{ data: { 'http.url': 'https://api.example.com/x', 'http.method': 'GET' } }],
    } as unknown as TransactionEvent;
    expect(scrubTransaction(event)).toBe(event);
  });

  it('leaves non-URL fields alone even if they contain `?`', () => {
    const event = {
      type: 'transaction',
      spans: [{ data: { description: 'what is this?', 'http.method': 'GET' } }],
    } as unknown as TransactionEvent;
    const out = scrubTransaction(event);
    const span0 = out.spans?.[0]?.data as Record<string, unknown> | undefined;
    expect(span0?.description).toBe('what is this?');
  });
});
