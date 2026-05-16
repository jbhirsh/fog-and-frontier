import { useEffect } from 'react';
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import * as Sentry from '@sentry/react';
import type { TransactionEvent } from '@sentry/core';

// Production error monitoring + tracing for the browser. Server-side errors
// are covered by Vercel Observability via api/_log.ts. See issue #20.
//
// Defense in depth: although the Gemini API key only exists server-side and
// never reaches the browser, strip query strings from any captured URL anyway
// — Sentry's default breadcrumbs include fetch URLs and we don't want any
// fingerprint of upstream call patterns leaking either. PII (IP, cookies) is
// off by default via sendDefaultPii: false.

type Breadcrumb = Sentry.Breadcrumb;
type Event = Sentry.ErrorEvent;

const URL_QUERY_RE = /\?.*$/;
// Embedded-URL form: a `?` followed by non-whitespace/punctuation. Used to
// scrub query strings out of arbitrary text (e.g. exception.values[].value),
// not full-URL strings — those use stripQueryString instead.
const EMBEDDED_QUERY_RE = /\?[^\s"'<>,)\]}]*/g;

export function stripQueryString(url: string): string {
  return url.replace(URL_QUERY_RE, '');
}

export function scrubEmbeddedQueries(text: string): string {
  return text.replace(EMBEDDED_QUERY_RE, '');
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (data && typeof data === 'object') {
    const url = (data as { url?: unknown }).url;
    if (typeof url === 'string' && url.includes('?')) {
      return {
        ...breadcrumb,
        data: { ...(data as Record<string, unknown>), url: stripQueryString(url) },
      };
    }
  }
  return breadcrumb;
}

// Scrub URL-shaped attributes in a span/context data bag. Keys matching
// /url/i get stripQueryString applied; everything else passes through.
// Returns the same reference when nothing changed (so callers can keep
// shallow-equality short-circuits).
function scrubUrlAttrs<T extends object>(data: T): T {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v.includes('?') && /url/i.test(k)) {
      next[k] = stripQueryString(v);
      changed = true;
    } else {
      next[k] = v;
    }
  }
  return changed ? (next as T) : data;
}

export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  let next = event;
  const trace = next.contexts?.trace;
  if (trace?.data) {
    const scrubbed = scrubUrlAttrs(trace.data);
    if (scrubbed !== trace.data) {
      next = {
        ...next,
        contexts: { ...next.contexts, trace: { ...trace, data: scrubbed } },
      };
    }
  }
  const spans = next.spans;
  if (Array.isArray(spans)) {
    let spanChanged = false;
    const scrubbedSpans = spans.map((span) => {
      if (!span.data) return span;
      const scrubbed = scrubUrlAttrs(span.data);
      if (scrubbed !== span.data) {
        spanChanged = true;
        return { ...span, data: scrubbed };
      }
      return span;
    });
    if (spanChanged) {
      next = { ...next, spans: scrubbedSpans };
    }
  }
  return next;
}

export function scrubEvent(event: Event): Event {
  let next = event;
  const request = event.request;
  if (request && typeof request.url === 'string' && request.url.includes('?')) {
    next = { ...next, request: { ...request, url: stripQueryString(request.url) } };
  }
  // Defense in depth: if a `?key=...` ever appears inside an exception
  // message (e.g. a stack-trace-echoed URL), strip the query string.
  const values = next.exception?.values;
  if (Array.isArray(values) && values.some((v) => typeof v.value === 'string' && v.value.includes('?'))) {
    const scrubbed = values.map((v) =>
      typeof v.value === 'string' && v.value.includes('?')
        ? { ...v, value: scrubEmbeddedQueries(v.value) }
        : v,
    );
    next = { ...next, exception: { ...next.exception, values: scrubbed } };
  }
  return next;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  const environment =
    (import.meta.env.VITE_VERCEL_ENV as string | undefined) ??
    import.meta.env.MODE;
  // Production samples 10% of transactions to stay inside Sentry's free-tier
  // quota; preview/dev capture everything so a sneeze surfaces.
  const tracesSampleRate = environment === 'production' ? 0.1 : 1.0;

  Sentry.init({
    dsn,
    environment,
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined,
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracesSampleRate,
    // Lock distributed-trace headers to same-origin requests. The default
    // (same-origin + localhost) would start propagating sentry-trace +
    // baggage headers to any third-party fetch added later (Clerk, Turso).
    tracePropagationTargets: [/^\//],
    sendDefaultPii: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
  });
}

export { Sentry };
