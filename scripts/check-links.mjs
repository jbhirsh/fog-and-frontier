#!/usr/bin/env node
/**
 * Link audit (#68). Checks every outbound link the catalog surfaces (AllTrails,
 * menu and reservation links, cover images) and prints a Markdown report.
 *
 * Usage:
 *   node scripts/check-links.mjs [baseUrl]   (default: production)
 *   LINKS_REPORT=report.md node scripts/check-links.mjs
 *
 * Reads the catalog through the public `activities` query, so it audits what
 * visitors actually see (rows added in the app included) and needs no
 * credentials. Exits 1 when any link is dead, 0 otherwise: links to review
 * by hand (bot blocks, server errors) don't fail it.
 */

import { writeFileSync } from 'node:fs';
import {
  ACTIVITIES_QUERY,
  HOST_STRIKES,
  collectLinks,
  judge,
  report,
  retryDelayMs,
} from './link-check.mjs';

const baseUrl = process.argv[2] ?? process.env.LINKS_BASE_URL ?? 'https://fog-and-frontier.vercel.app';
const TIMEOUT_MS = 15_000;
// Says who's asking, as Wikimedia's policy for automated clients requires
// (it rate-limits anonymous scripts hard), in the browser-compatible form
// other hosts accept.
const USER_AGENT =
  'Mozilla/5.0 (compatible; FogAndFrontierLinkCheck/1.0; +https://github.com/jbhirsh/fog-and-frontier)';
// Pace per host, and how often to retry a 429 before calling it "review".
const HOST_GAP_MS = 750;
const RATE_LIMIT_RETRIES = 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCatalog() {
  const res = await fetch(new URL('/api/graphql', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: ACTIVITIES_QUERY }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // An HTML error page, say: reported below with the status.
  }
  if (!res.ok || !body?.data?.activities) {
    const detail = body?.errors?.[0]?.message ?? text.slice(0, 200);
    throw new Error(`catalog read failed: HTTP ${res.status}: ${detail}`);
  }
  return body.data.activities;
}

// GET, not HEAD: plenty of hosts answer HEAD wrongly. The body is dropped
// unread once the status and type are in.
async function probe(url) {
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        await sleep(retryDelayMs(res.headers.get('retry-after')));
        continue;
      }
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        finalUrl: res.url,
      };
    }
  } catch (err) {
    if (err?.name === 'TimeoutError') return { error: 'timeout' };
    // undici hangs the specific reason (ENOTFOUND, a redirect loop) on cause.
    return { error: err?.cause?.code ?? err?.cause?.message ?? err?.code ?? err?.message ?? 'fetch failed' };
  }
}

// One request at a time per host, so a big host isn't hammered; hosts run
// side by side. A host that keeps refusing (429s or timeouts in a row) isn't
// probed further: its remaining links go to review, so one host can't stall
// the run past its time limit.
async function checkAll(links) {
  const byHost = new Map();
  for (const link of links) {
    const host = URL.canParse(link.url) ? new URL(link.url).hostname : '';
    byHost.set(host, [...(byHost.get(host) ?? []), link]);
  }
  const results = [];
  await Promise.all(
    [...byHost.values()].map(async (queue) => {
      let strikes = 0;
      for (const [i, link] of queue.entries()) {
        if (strikes >= HOST_STRIKES) {
          results.push({ ...link, ...judge(link, { skipped: 'host kept refusing; not probed' }) });
          continue;
        }
        if (i > 0) await sleep(HOST_GAP_MS);
        const outcome = URL.canParse(link.url) ? await probe(link.url) : { error: 'bad url' };
        strikes = outcome.status === 429 || outcome.error === 'timeout' ? strikes + 1 : 0;
        results.push({ ...link, ...judge(link, outcome) });
      }
    }),
  );
  const order = (r) => `${r.name}\u0000${r.field}`;
  return results.sort((a, b) => order(a).localeCompare(order(b)));
}

const activities = await fetchCatalog();
const results = await checkAll(collectLinks(activities));
const markdown = report(results);
process.stdout.write(markdown);
if (process.env.LINKS_REPORT) writeFileSync(process.env.LINKS_REPORT, markdown);
// exitCode, not exit(): lets a piped stdout finish flushing first.
process.exitCode = results.some((r) => r.verdict === 'dead') ? 1 : 0;
