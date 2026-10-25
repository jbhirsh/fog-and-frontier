// Production's data and photos for a local build of the app, so pictures
// of it (PR GIFs, through jbhirsh/ci's GIF tool and scripts/gif-setup.ts;
// the README's screenshots, scripts/readme-screenshots.ts) show it exactly
// as production does: the real catalog, road miles and completions, every
// photo as production's image CDN serves it, the real fonts, and the map's
// tiles from OpenStreetMap (CARTO's need a key only Vercel has). Never the
// visual tests' stub, whose fixtures have blank covers and which blanks
// every outside image (tests/visual/helpers.ts's mockApis): over it,
// liveSite sends every read to production's API, a read production refuses
// (a signed-in one) gets the stub's answer, cachePhotos brings every
// picture in through production's image CDN, and waitForPhotos holds a
// capture until the photos in view load.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** The live site, whose catalog, road miles and image CDN a recording uses. */
export const PRODUCTION = 'https://fog-and-frontier.vercel.app';
/** Its API. */
export const LIVE_GRAPHQL = `${PRODUCTION}/api/graphql`;
/**
 * The width and quality production's image CDN is asked for a photo the
 * build doesn't send through it: the largest of vercel.json's images.sizes,
 * and its one quality.
 */
export const CDN_WIDTH = 1280;
export const CDN_QUALITY = 75;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i;
const CARTO_TILE =
  /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/[^/]+\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.png/;

/** The OpenStreetMap tile for a CARTO tile's URL, or null if it isn't one. */
export function osmTile(url: string): string | null {
  const match = CARTO_TILE.exec(url);
  return match ? `https://tile.openstreetmap.org/${match[1]}/${match[2]}/${match[3]}.png` : null;
}

/**
 * The live site's data for a local build, over the scenario's stubbed API
 * (call it after the stub, e.g. tests/visual/helpers.ts's mockApis, so this
 * comes first): every GraphQL read goes to production's API (`api`), so the
 * build shows production's catalog, road miles and completions. A read
 * production can't answer goes to the stub: one it refuses without a real
 * sign-in (trips, owner-only reads, for the test flags' signed-in account),
 * or one asking for a field this branch adds. Writes go to the stub too. The
 * fonts load for real, which the stub blanks.
 */
export async function liveSite(page: Pick<Page, 'route'>, api = LIVE_GRAPHQL): Promise<void> {
  const stubbed = new Set<string>();
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      operationName?: string;
    } | null;
    if (!/^\s*query\b/.test(body?.query ?? '')) return route.fallback();
    try {
      const response = await route.fetch({ url: api });
      const json = (await response.json()) as { errors?: unknown[] };
      if (response.ok() && !json.errors?.length) return await route.fulfill({ response, json });
    } catch {
      // Unreachable: the stub's answer it is.
    }
    const name = body?.operationName ?? 'a read';
    if (!stubbed.has(name)) {
      stubbed.add(name);
      console.warn(`pr-gif: ${api} couldn't answer ${name}, so the stub did`);
    }
    return route.fallback();
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.continue());
}

/**
 * Where a recording fetches a picture from, or null to leave it to the
 * build's own server (its own assets):
 *   - a CARTO map tile, from OpenStreetMap, since CARTO's need the site's
 *     key, which only Vercel has;
 *   - a request to the image CDN (/_vercel/image, which a local server
 *     doesn't have), from production's;
 *   - any other photo, through production's CDN, at CDN_WIDTH.
 * So photos look as production shows them, and no image host is asked
 * directly (Wikimedia, which has most of the catalog's, throttles a machine
 * that asks too often). `direct` is the photo's own URL, to try if
 * production's CDN can't serve it (a host it doesn't allow, or a production
 * without the CDN yet).
 */
export function pictureSource(
  url: string,
  production = PRODUCTION,
): { url: string; direct?: string } | null {
  const tile = osmTile(url);
  if (tile) return { url: tile };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.pathname === '/_vercel/image') {
    return {
      url: `${production}/_vercel/image${parsed.search}`,
      direct: parsed.searchParams.get('url') ?? undefined,
    };
  }
  if (['localhost', '127.0.0.1'].includes(parsed.hostname) || !/^https?:$/.test(parsed.protocol))
    return null;
  return {
    url: `${production}/_vercel/image?url=${encodeURIComponent(url)}&w=${CDN_WIDTH}&q=${CDN_QUALITY}`,
    direct: url,
  };
}

/** Where photos are kept between recordings. */
export const PHOTO_CACHE = join(homedir(), '.cache', 'pr-gif', 'photos');

/** A photo's file in the cache: its URL's hash. */
export function photoFile(cache: string, url: string): string {
  return join(cache, createHash('sha1').update(url).digest('hex'));
}

/**
 * Serves the page's pictures (photos and map tiles) from where pictureSource
 * says, through a cache on disk, fetching each one once, so "before",
 * "after" and later recordings don't ask again. A picture that fails both
 * ways isn't cached, and goes in `failed` (its own URL, and the status or
 * error), for the caller to refuse a recording with gaps in it. Register it
 * last, so it comes before any other route for images.
 */
export async function cachePhotos(
  page: Pick<Page, 'route'>,
  { cache = PHOTO_CACHE, production = PRODUCTION }: { cache?: string; production?: string } = {},
): Promise<{ failed: Map<string, string> }> {
  const failed = new Map<string, string>();
  mkdirSync(cache, { recursive: true });
  await page.route(
    (url) => IMAGE.test(url.href) || url.pathname === '/_vercel/image',
    async (route) => {
      const requested = route.request().url();
      const source = pictureSource(requested, production);
      if (!source) return route.fallback();
      const named = source.direct ?? source.url;
      const file = photoFile(cache, source.url);
      if (existsSync(file) && existsSync(`${file}.type`)) {
        return route.fulfill({
          body: readFileSync(file),
          contentType: readFileSync(`${file}.type`, 'utf8'),
        });
      }
      let why = '';
      let refusal: Awaited<ReturnType<typeof route.fetch>> | undefined;
      for (const url of source.direct ? [source.url, source.direct] : [source.url]) {
        try {
          const response = await route.fetch({ url });
          // An image, not just a 200: a site without the image CDN answers
          // /_vercel/image with its own index.html.
          const type = response.headers()['content-type'] ?? 'image/jpeg';
          if (response.ok() && type.startsWith('image/')) {
            const body = await response.body();
            writeFileSync(file, body);
            writeFileSync(`${file}.type`, type);
            failed.delete(named);
            return await route.fulfill({ response, body });
          }
          why = response.ok() ? `not an image (${type})` : `HTTP ${response.status()}`;
          refusal = response;
        } catch (error) {
          why = error instanceof Error ? error.message.split('\n')[0] : String(error);
        }
      }
      failed.set(named, why);
      return refusal ? route.fulfill({ response: refusal }) : route.abort();
    },
  );
  return { failed };
}

/** Says which photos didn't load, by host, e.g. "3 from upload.wikimedia.org (HTTP 429)". */
export function describeFailed(failed: ReadonlyMap<string, string>): string {
  const byHost = new Map<string, { count: number; why: Set<string> }>();
  for (const [url, why] of failed) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // Not a URL: named as it is.
    }
    const entry = byHost.get(host) ?? { count: 0, why: new Set<string>() };
    entry.count += 1;
    entry.why.add(why);
    byHost.set(host, entry);
  }
  return [...byHost]
    .map(([host, { count, why }]) => `${count} from ${host} (${[...why].join(', ')})`)
    .join('; ');
}

/**
 * Waits (up to `timeoutMs`) for the photos in view to load, so a recording
 * doesn't open on blank cards: a lazy one counts from its src, before it has
 * started. One that failed counts as done here, so this doesn't wait it out;
 * cachePhotos says which failed. Ones further down load as they're scrolled
 * to.
 */
export async function waitForPhotos(
  page: Pick<Page, 'waitForFunction'>,
  timeoutMs = 20_000,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      () =>
        [...document.images].every((img) => {
          const box = img.getBoundingClientRect();
          const inView = box.bottom > 0 && box.top < innerHeight && box.width > 0;
          return !inView || !img.getAttribute('src') || img.complete;
        }),
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    console.warn(`pr-gif: some photos in view hadn't loaded after ${timeoutMs / 1000} s`);
    return false;
  }
}
