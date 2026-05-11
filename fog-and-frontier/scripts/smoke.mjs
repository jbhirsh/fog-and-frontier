#!/usr/bin/env node
/**
 * Production smoke gate. Verifies a deployed build actually serves what it should.
 * Usage:
 *   node scripts/smoke.mjs <baseUrl>
 *   SMOKE_BASE_URL=https://... node scripts/smoke.mjs
 *
 * Exits 0 on success, nonzero on any failed check. Logs every check.
 */

const SENTINEL_ACTIVITY_SLUG = 'the-horse-park-at-woodside';
const TIMEOUT_MS = 15_000;

const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL;
if (!baseUrl) {
  console.error('usage: node scripts/smoke.mjs <baseUrl>');
  process.exit(2);
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

async function checkActivities() {
  const url = new URL('/api/activities', baseUrl).toString();
  try {
    const res = await fetchWithTimeout(url);
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
    if (keys.length === 0) {
      record('GET /api/activities', false, 'response has zero activities (DB empty or rows dropped)');
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
    record('GET /api/activities', true, `${keys.length} activities including sentinel`);
  } catch (err) {
    record('GET /api/activities', false, `request failed: ${err.message ?? err}`);
  }
}

async function checkCompleted() {
  const url = new URL('/api/completed', baseUrl).toString();
  try {
    const res = await fetchWithTimeout(url);
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

console.log(`Smoke gate against ${baseUrl}`);
await checkActivities();
await checkCompleted();
await checkHtmlAndCss();

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);

process.exit(hadFailure ? 1 : 0);
