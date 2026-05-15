#!/usr/bin/env node
/**
 * Production smoke gate. Verifies a deployed build actually serves what it should.
 * Usage:
 *   node scripts/smoke.mjs <baseUrl>
 *   SMOKE_BASE_URL=https://... node scripts/smoke.mjs
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — regression: build looks real (CSS link present) but some check failed
 *   2 — not-yet-built: the preview Vercel served has no built CSS link AND APIs 404
 *       (typical "Builds: [0ms]" cached/no-build preview). Caller can retry.
 *   3 — usage error
 *
 * Designed to be re-runnable from a polling loop in CI: when exit=2, the workflow
 * keeps waiting; when exit=1, it fails fast.
 *
 * /api/* checks retry transient 5xx internally (Turso libSQL cold-start can
 * 500 the first request after a fresh Preview deploy). See fetchApiOk.
 */

const SENTINEL_ACTIVITY_SLUG = 'the-horse-park-at-woodside';
const TIMEOUT_MS = 15_000;

// Regression floor for /api/activities (incident #24 follow-up). If a deploy
// would publish fewer activities than the floor, fail closed. Override via
// MIN_ACTIVITIES env when seeding new content legitimately raises the floor.
const MIN_ACTIVITIES = Number(process.env.MIN_ACTIVITIES ?? 64);

// On Preview, the deployed app reads from a Turso replica that may not match
// Production's row set (same DB credentials, divergent reads observed in CI:
// prod returns 4 activities, preview returns {}). Sentinel-by-slug is only
// meaningful when we know the read target is the same DB Production reads.
// Default to strict so local runs against prod stay strict.
const STRICT = (process.env.SMOKE_ENV ?? 'Production') === 'Production';

const EXIT_OK = 0;
const EXIT_REGRESSION = 1;
const EXIT_NOT_BUILT = 2;
const EXIT_USAGE = 3;

const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL;
if (!baseUrl) {
  console.error('usage: node scripts/smoke.mjs <baseUrl>');
  process.exit(EXIT_USAGE);
}

// Vercel preview URLs have deployment protection. Bypass via the
// "Protection Bypass for Automation" secret. Sent both as a header and
// as a query param so CDN edge auth doesn't strip it.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const bypassHeaders = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
function withBypass(url) {
  if (!bypass) return url;
  const u = new URL(url);
  u.searchParams.set('x-vercel-protection-bypass', bypass);
  u.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return u.toString();
}

const results = [];
let hadFailure = false;

// Build-presence signals. We use these to decide between "regression" and
// "not yet built" when something fails. A no-build cached preview returns
// HTML without a hashed /assets/*.css link and 404s the API routes.
const signals = {
  cssLinkPresent: false,
  apiActivitiesStatus: null,
  apiCompletedStatus: null,
};

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  hadFailure = hadFailure || !ok;
  const marker = ok ? 'PASS' : 'FAIL';
  console.log(`[${marker}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(withBypass(url), {
      ...opts,
      headers: { ...bypassHeaders, ...(opts.headers ?? {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// On Preview, /api/* can 5xx during Turso cold-start (libSQL serverless
// instances pause when idle and take a few seconds to wake on first hit).
// Retry transient 5xx a few times before declaring a regression. Worst-case
// budget per check: ~15s of sleep across 4 retries + 5 fetch RTTs.
async function fetchApiOk(url) {
  const backoffsMs = [1000, 2000, 4000, 8000];
  let res = await fetchWithTimeout(url);
  for (let i = 0; i < backoffsMs.length; i++) {
    if (res.status < 500) return res;
    console.log(
      `  [retry ${i + 1}/${backoffsMs.length}] ${url} → ${res.status}; waiting ${backoffsMs[i]}ms`,
    );
    await new Promise((r) => setTimeout(r, backoffsMs[i]));
    res = await fetchWithTimeout(url);
  }
  return res;
}

async function checkActivities() {
  const url = new URL('/api/activities', baseUrl).toString();
  try {
    const res = await fetchApiOk(url);
    signals.apiActivitiesStatus = res.status;
    if (res.status !== 200) {
      record('GET /api/activities', false, `expected 200, got ${res.status}`);
      return;
    }
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('application/json')) {
      record('GET /api/activities', false, `expected JSON, got ${ctype}`);
      return;
    }
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      record('GET /api/activities', false, 'expected object body');
      return;
    }
    const keys = Object.keys(data);
    if (STRICT) {
      if (keys.length === 0) {
        record('GET /api/activities', false, 'response has zero activities (DB empty or rows dropped)');
        return;
      }
      if (keys.length < MIN_ACTIVITIES) {
        record(
          'GET /api/activities',
          false,
          `regression: ${keys.length} activities < MIN_ACTIVITIES floor (${MIN_ACTIVITIES})`,
        );
        return;
      }
      if (!(SENTINEL_ACTIVITY_SLUG in data)) {
        record(
          'GET /api/activities',
          false,
          `sentinel "${SENTINEL_ACTIVITY_SLUG}" missing from response (got ${keys.length} keys; first: ${keys[0]})`,
        );
        return;
      }
      record('GET /api/activities', true, `${keys.length} activities (≥${MIN_ACTIVITIES}), sentinel present`);
      return;
    }
    record('GET /api/activities', true, `${keys.length} activities (shape-only check on non-Production)`);
  } catch (err) {
    record('GET /api/activities', false, `request failed: ${err.message ?? err}`);
  }
}

async function checkCompleted() {
  const url = new URL('/api/completed', baseUrl).toString();
  try {
    const res = await fetchApiOk(url);
    signals.apiCompletedStatus = res.status;
    if (res.status !== 200) {
      record('GET /api/completed', false, `expected 200, got ${res.status}`);
      return;
    }
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('application/json')) {
      record('GET /api/completed', false, `expected JSON, got ${ctype}`);
      return;
    }
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      record('GET /api/completed', false, 'expected object body');
      return;
    }
    record('GET /api/completed', true, `${Object.keys(data).length} entries`);
  } catch (err) {
    record('GET /api/completed', false, `request failed: ${err.message ?? err}`);
  }
}

async function checkHtmlAndCss() {
  const url = new URL('/', baseUrl).toString();
  let html;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) {
      record('GET /', false, `expected 200, got ${res.status}`);
      return;
    }
    html = await res.text();
  } catch (err) {
    record('GET /', false, `request failed: ${err.message ?? err}`);
    return;
  }

  if (!html.includes('<title>')) {
    record('GET /', false, 'HTML missing <title> — index.html may not be served');
    return;
  }
  record('GET /', true, `${html.length} bytes`);

  const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/);
  if (!cssMatch) {
    record('Locate built CSS asset', false, 'no /assets/*.css link in HTML');
    return;
  }
  signals.cssLinkPresent = true;
  const cssPath = cssMatch[1];
  record('Locate built CSS asset', true, cssPath);

  const cssUrl = new URL(cssPath, baseUrl).toString();
  try {
    const res = await fetchWithTimeout(cssUrl);
    if (res.status !== 200) {
      record('GET CSS asset', false, `expected 200, got ${res.status}`);
      return;
    }
    const body = await res.text();
    if (body.length < 1000) {
      record('GET CSS asset', false, `CSS suspiciously small (${body.length} bytes)`);
      return;
    }
    if (!body.includes('tailwindcss')) {
      record('GET CSS asset', false, 'CSS missing Tailwind banner — build may have dropped styles');
      return;
    }
    record('GET CSS asset', true, `${body.length} bytes, Tailwind banner present`);
  } catch (err) {
    record('GET CSS asset', false, `request failed: ${err.message ?? err}`);
  }
}

console.log(`Smoke gate against ${baseUrl} (SMOKE_ENV=${process.env.SMOKE_ENV ?? 'Production (default)'}, strict=${STRICT})`);
await checkActivities();
await checkCompleted();
await checkHtmlAndCss();

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);

if (!hadFailure) {
  process.exit(EXIT_OK);
}

// Decide between regression and not-yet-built. Vercel's no-build cached
// preview signature: HTML served (so we got past GET /) but no hashed CSS
// link AND both API routes return 404. If we see that combination, tell
// the caller this is a stub, not a regression.
const apiActivities404 = signals.apiActivitiesStatus === 404;
const apiCompleted404 = signals.apiCompletedStatus === 404;
const looksUnbuilt = !signals.cssLinkPresent && apiActivities404 && apiCompleted404;

if (looksUnbuilt) {
  console.log(
    '\n[SMOKE_UNBUILT] preview looks like a Vercel no-build cached stub ' +
      '(no /assets/*.css link in HTML AND /api/activities + /api/completed both 404). ' +
      'Not treating as a regression yet — caller should retry or escalate.',
  );
  process.exit(EXIT_NOT_BUILT);
}

console.log(
  '\n[SMOKE_REGRESSION] preview appears to be a real build but at least one check failed. ' +
    `Signals: cssLinkPresent=${signals.cssLinkPresent}, ` +
    `apiActivitiesStatus=${signals.apiActivitiesStatus}, ` +
    `apiCompletedStatus=${signals.apiCompletedStatus}.`,
);
process.exit(EXIT_REGRESSION);
