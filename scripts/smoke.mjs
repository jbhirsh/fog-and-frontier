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
 *   2 — not-yet-built: the preview Vercel served has no built CSS link AND the
 *       GraphQL API 404s (typical "Builds: [0ms]" cached/no-build preview).
 *   3 — usage error
 *
 * Designed to be re-runnable from a polling loop in CI: when exit=2, the workflow
 * keeps waiting; when exit=1, it fails fast.
 *
 * Single-function migration (#91): every REST endpoint now lives behind one
 * GraphQL function at /api/graphql. The read-only canary POSTs
 *   { activities { id } completed { id } }
 * and asserts the catalog floor — no mutations against prod.
 */

const SENTINEL_ACTIVITY_SLUG = 'the-horse-park-at-woodside';
const TIMEOUT_MS = 15_000;

// Regression floor for the activities catalog (incident #24 follow-up). If a
// deploy would publish fewer activities than the floor, fail closed. Override
// via MIN_ACTIVITIES env when seeding new content legitimately raises the floor.
const MIN_ACTIVITIES = Number(process.env.MIN_ACTIVITIES ?? 64);

// On Preview, the deployed app reads from a Turso replica that may not match
// Production's row set (same DB credentials, divergent reads observed in CI).
// Sentinel-by-slug is only meaningful when we know the read target is the same
// DB Production reads. Default to strict so local runs against prod stay strict.
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
// HTML without a hashed /assets/*.css link and 404s the GraphQL route.
const signals = {
  cssLinkPresent: false,
  graphqlStatus: null,
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

// Read-only GraphQL canary: one POST that pulls both catalog reads at once.
async function checkGraphql() {
  const url = new URL('/api/graphql', baseUrl).toString();
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ activities { id } completed { id } }' }),
    });
  } catch (err) {
    record('POST /api/graphql', false, `request failed: ${err.message ?? err}`);
    return;
  }
  signals.graphqlStatus = res.status;
  if (res.status !== 200) {
    record('POST /api/graphql', false, `expected 200, got ${res.status}`);
    return;
  }
  const ctype = res.headers.get('content-type') ?? '';
  if (!ctype.includes('application/json')) {
    record('POST /api/graphql', false, `expected JSON, got ${ctype}`);
    return;
  }

  let payload;
  try {
    payload = await res.json();
  } catch (err) {
    record('POST /api/graphql', false, `body was not JSON: ${err.message ?? err}`);
    return;
  }

  if (payload?.errors?.length) {
    record(
      'POST /api/graphql',
      false,
      `GraphQL errors: ${payload.errors.map((e) => e.message).join('; ').slice(0, 300)}`,
    );
    return;
  }

  const activities = payload?.data?.activities;
  const completed = payload?.data?.completed;
  if (!Array.isArray(activities)) {
    record('POST /api/graphql', false, 'data.activities is not an array');
    return;
  }
  if (!Array.isArray(completed)) {
    record('POST /api/graphql', false, 'data.completed is not an array');
    return;
  }
  record('GraphQL completed read', true, `${completed.length} entries`);

  if (STRICT) {
    if (activities.length === 0) {
      record('GraphQL activities read', false, 'zero activities (DB empty or rows dropped)');
      return;
    }
    if (activities.length < MIN_ACTIVITIES) {
      record(
        'GraphQL activities read',
        false,
        `regression: ${activities.length} activities < MIN_ACTIVITIES floor (${MIN_ACTIVITIES})`,
      );
      return;
    }
    if (!activities.some((a) => a?.id === SENTINEL_ACTIVITY_SLUG)) {
      record(
        'GraphQL activities read',
        false,
        `sentinel "${SENTINEL_ACTIVITY_SLUG}" missing (got ${activities.length} activities; first: ${activities[0]?.id})`,
      );
      return;
    }
    record(
      'GraphQL activities read',
      true,
      `${activities.length} activities (≥${MIN_ACTIVITIES}), sentinel present`,
    );
    return;
  }
  record(
    'GraphQL activities read',
    true,
    `${activities.length} activities (shape-only check on non-Production)`,
  );
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
await checkGraphql();
await checkHtmlAndCss();

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);

if (!hadFailure) {
  process.exit(EXIT_OK);
}

// Decide between regression and not-yet-built. Vercel's no-build cached
// preview signature: HTML served (so we got past GET /) but no hashed CSS
// link AND the GraphQL route 404s. If we see that combination, tell the
// caller this is a stub, not a regression.
const graphql404 = signals.graphqlStatus === 404;
const looksUnbuilt = !signals.cssLinkPresent && graphql404;

if (looksUnbuilt) {
  console.log(
    '\n[SMOKE_UNBUILT] preview looks like a Vercel no-build cached stub ' +
      '(no /assets/*.css link in HTML AND /api/graphql 404). ' +
      'Not treating as a regression yet — caller should retry or escalate.',
  );
  process.exit(EXIT_NOT_BUILT);
}

console.log(
  '\n[SMOKE_REGRESSION] preview appears to be a real build but at least one check failed. ' +
    `Signals: cssLinkPresent=${signals.cssLinkPresent}, ` +
    `graphqlStatus=${signals.graphqlStatus}.`,
);
process.exit(EXIT_REGRESSION);
