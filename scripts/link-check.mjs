/**
 * Link audit (#68): the pure half. Which links an activity surfaces, how a
 * response is judged, and the report. scripts/check-links.mjs does the
 * fetching.
 *
 * Three verdicts:
 *   ok      — the link works (an image link must also serve an image).
 *   dead    — gone: 404/410, a host that doesn't resolve, or an image link
 *             that serves a page instead. Fix or remove these.
 *   review  — can't tell from a script: a bot block or challenge (any other
 *             4xx, a 202; every AllTrails page answers a script with 403), a
 *             server error, a timeout, a page that now redirects to the home
 *             page, or a host that kept refusing and wasn't probed further.
 *             Check these in a browser before calling them dead.
 */

/** The activity fields that link out, and whether each must be an image. */
export const LINK_FIELDS = [
  { field: 'allTrailsUrl', image: false },
  { field: 'menuUrl', image: false },
  { field: 'reservationUrl', image: false },
  { field: 'coverImage', image: true },
];

/** Hosts that refuse scripts outright: their 403 says nothing about the page. */
export const BOT_BLOCKING_HOSTS = ['alltrails.com'];

/** The fields the checker asks the API for. */
export const ACTIVITIES_QUERY = `{ activities { id name ${LINK_FIELDS.map((f) => f.field).join(' ')} } }`;

/** Every outbound link in the catalog, one entry per (activity, field). */
export function collectLinks(activities) {
  const links = [];
  for (const activity of activities) {
    for (const { field, image } of LINK_FIELDS) {
      const url = activity[field];
      if (typeof url === 'string' && url.trim()) {
        links.push({ id: activity.id, name: activity.name, field, url: url.trim(), image });
      }
    }
  }
  return links;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function blocksBots(host) {
  return BOT_BLOCKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** 2xx answers that are the resource itself, as opposed to a 202 challenge page. */
const REAL_SUCCESS = [200, 203, 206];

/**
 * Judges one link from what fetching it produced: `{ status, contentType,
 * finalUrl }` for a response (after redirects), `{ error }` (a Node error
 * code, or 'timeout') when there was none, or `{ skipped }` for a link not
 * probed (its host kept refusing).
 */
export function judge(link, outcome) {
  const host = hostOf(link.url);
  if (!host || !/^https?:$/.test(new URL(link.url).protocol)) {
    return { verdict: 'dead', reason: 'not a web address' };
  }
  if (outcome.skipped) return { verdict: 'review', reason: outcome.skipped };
  if (outcome.error) {
    if (outcome.error === 'ENOTFOUND') return { verdict: 'dead', reason: "host doesn't resolve" };
    return { verdict: 'review', reason: outcome.error === 'timeout' ? 'timed out' : outcome.error };
  }
  const { status, contentType = '', finalUrl } = outcome;
  // Only these say the page is gone. Other 4xx are as often a firewall's
  // answer to a script as a real error.
  if (status === 404 || status === 410) return { verdict: 'dead', reason: `HTTP ${status}` };
  if (status >= 400 && status < 500 || status === 999) {
    return {
      verdict: 'review',
      reason: blocksBots(host) ? `HTTP ${status} (blocks scripts)` : `HTTP ${status}`,
    };
  }
  if (status >= 500) return { verdict: 'review', reason: `HTTP ${status}` };
  if (status >= 200 && status < 300 && !REAL_SUCCESS.includes(status)) {
    return { verdict: 'review', reason: `HTTP ${status} (a challenge page?)` };
  }
  if (!REAL_SUCCESS.includes(status)) return { verdict: 'dead', reason: `HTTP ${status}` };
  if (link.image && !contentType.toLowerCase().startsWith('image/')) {
    return {
      verdict: 'dead',
      reason: `not an image (HTTP ${status}, ${contentType || 'no content type'})`,
    };
  }
  // A retired page often redirects to the site's home page, which answers 200.
  if (finalUrl && hostOf(finalUrl) && new URL(finalUrl).pathname === '/' && new URL(link.url).pathname !== '/') {
    return { verdict: 'review', reason: 'redirects to the home page' };
  }
  return { verdict: 'ok', reason: `HTTP ${status}` };
}

/**
 * How long to wait before retrying a 429, from its Retry-After header
 * (seconds or an HTTP date), capped. A missing or unreadable header gets the
 * fallback rather than an instant retry.
 */
export function retryDelayMs(header, now = Date.now(), { fallback = 5000, cap = 30_000 } = {}) {
  const value = header?.trim();
  if (!value) return fallback;
  // Seconds are digits; an HTTP date has a day and month name. Anything else
  // (Date.parse reads "-5" as a year) is unreadable.
  const ms = /^\d+$/.test(value)
    ? Number(value) * 1000
    : /[A-Za-z]/.test(value)
      ? Date.parse(value) - now
      : Number.NaN;
  if (!Number.isFinite(ms)) return fallback;
  return Math.min(Math.max(ms, 0), cap);
}

/** After this many refusals in a row (429s or timeouts), a host isn't probed further. */
export const HOST_STRIKES = 3;

/** A Markdown report of the results, dead first, then review, then a count. */
export function report(results) {
  const by = (v) => results.filter((r) => r.verdict === v);
  const dead = by('dead');
  const review = by('review');
  const ok = by('ok');
  const lines = [
    `# Link audit`,
    '',
    `${results.length} ${results.length === 1 ? 'link' : 'links'}: ${dead.length} dead, ${review.length} to review, ${ok.length} ok.`,
  ];
  const table = (title, rows) => {
    if (rows.length === 0) return;
    lines.push('', `## ${title}`, '', '| Activity | Field | Why | Link |', '|---|---|---|---|');
    // A | in a name or link would end its table cell early.
    const cell = (v) => String(v).replaceAll('|', '\\|');
    for (const r of rows) {
      lines.push(`| ${cell(r.name)} (\`${r.id}\`) | ${r.field} | ${cell(r.reason)} | ${cell(r.url)} |`);
    }
  };
  table('Dead', dead);
  table('Review by hand', review);
  return `${lines.join('\n')}\n`;
}
