// GIFs of the app for pull request descriptions, with the mouse pointer and
// the keys pressed drawn in, so a viewer can see where the pointer goes, what
// it presses and what's typed. Headless Chromium draws no cursor of its own.
//
//   - showPointer(context) draws, over every page the context opens: an arrow
//     that follows the pointer, a red ring while a button is down, a fading
//     trail while it drags, an arrow badge (↑ ↓ ← →) while the wheel scrolls,
//     and a label at the bottom of the recorded area for each key pressed
//     ("Tab", "Shift+Tab", "→", "Enter", or the text being typed).
//   - recordFrames(page, clip, dir) records every frame Chromium paints
//     (its screencast, 15-25 a second) until its stop() is called, noting
//     when each was painted and where the pointer was. stop() warns when the
//     pointer rested outside the clip for over half a second.
//   - framesToGif(dir, out, { width }) turns the frames into a GIF with the
//     system's ffmpeg, each frame shown for as long as it really lasted, so it
//     plays at the speed the page moved. Still frames at either end are
//     trimmed to a short pause, repeats in between merged into the frame they
//     repeat, none held longer than it was on screen, and one
//     palette is shared by the whole clip with only the area that changed
//     rewritten per frame, which keeps a few seconds of UI to a few hundred
//     KB.
//   - sideBySide(beforeDir, afterDir, out, { width }) joins two recordings
//     into one GIF, labelled "Before" and "After", playing in step (its
//     labels need an ffmpeg built with freetype and fontconfig, as most are).
//
// The screencast rather than screenshots, which take a few hundred ms each
// and catch a move in one or two places, or Playwright's own video
// recorder, which needs an ffmpeg build of its own.
//
// For a before/after pair of a UI change, scripts/pr-gif-cli.ts does it all
// in one command: builds main and this branch, records a scenario (see
// scripts/gif-scenarios/) against both, and puts the GIFs on the screenshots
// branch. By hand, from a script run with `node --experimental-strip-types`
// (import this file with its .ts extension), against a local build
// (`vite build --mode test`, then `vite preview`):
//
//   const context = await browser.newContext({
//     viewport: { width: 900, height: 560 },
//     deviceScaleFactor: 2,                  // as a high-density screen draws it
//     serviceWorkers: 'block',
//   });
//   await showPointer(context);              // before the first page loads
//   const page = await context.newPage();
//   await mockApis(page);                    // tests/visual/helpers.ts's stub
//   await liveSite(page);                    // production's reads and fonts over it
//   await cachePhotos(page);                 // photos via production's image CDN
//   await page.goto('http://localhost:4173/');
//   await waitForPhotos(page);
//   const stop = recordFrames(page, { x: 0, y: 0, width: 900, height: 400 }, 'frames');
//   await glide(page, { x: 450, y: 200 }, 0);       // where it starts
//   await page.waitForTimeout(400);
//   await click(page, page.getByRole('button', { name: 'Open' }));
//   await page.waitForTimeout(1000);                 // a pause to follow it by
//   await scroll(page, 400);                         // shown as a ↓ by the pointer
//   await page.keyboard.press('Tab');                // shown as "Tab" at the bottom
//   await page.waitForTimeout(1500);                 // the pause it ends on
//   await stop();
//   framesToGif('frames', 'after.gif', { width: 600 });
//
// Rules for recording:
//
//   - Moving: glide(), click() and drag(), with pauses between actions. They
//     go by the clock: page.mouse.move(x, y, { steps }) sends every step in a
//     few milliseconds, and a bare down()/up() presses for none, so frames
//     would catch the arrow in one or two places and miss the press.
//     locator.click() sends no pointer moves at all.
//   - Scrolling: scroll(), once the pointer is over whatever scrolls. A
//     single page.mouse.wheel leaps between two frames; window.scrollTo
//     shows nothing.
//   - Ending: on a pause (about 1.5 s), which the GIF holds before it loops.
//     Nothing is held longer than it was on screen.
//   - Keys: page.keyboard.press / type. Each shows at the bottom of the page.
//   - Framing: keep the pointer inside the clip while it rests between
//     actions, or it vanishes from the GIF. stop() warns when it doesn't.
//   - Where: a local production build (`vite build --mode test`, for the
//     visual tests' owner and sign-in flags, served by `vite preview` on
//     localhost), never the dev server, which renders everything twice and
//     runs unbundled code. It reads production's data: the API is stubbed
//     (mockApis in tests/visual/helpers.ts, which lets nothing but
//     localhost through and blanks every outside image and font), and over
//     the stub, liveSite(page) sends every read to production's API and
//     lets the fonts through. A read production refuses (a signed-in one)
//     gets the stub's answer. scripts/pr-gif-cli.ts does all of it.
//   - Pictures: never blank, and as production shows them. cachePhotos(page)
//     brings every photo in through production's image CDN (and the map's
//     tiles from OpenStreetMap, since CARTO's need a key only Vercel has),
//     and waitForPhotos(page) holds the recording until the photos in view
//     load.
//   - Checking: before publishing, look at a few frames (the start,
//     mid-action and the end) to see the GIF shows what it should, and list
//     the long ones (ffprobe -select_streams v -show_entries
//     packet=pts_time,duration_time): one over ~120 ms mid-move means no
//     input reached the page then.
//
// GIFs go on the `screenshots` branch with the PR's other pictures, linked
// by commit SHA (see CLAUDE.md, "Show UI changes in the PR").

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * One recorded flow, for scripts/pr-gif-cli.ts to play against main's build
 * and this branch's. See scripts/gif-scenarios/ for examples.
 */
export interface Scenario {
  /** Names the GIFs: <name>-before.gif, <name>-after.gif. */
  name: string;
  /** Where the page opens, from the site's root: '/', '/?view=map'. */
  path: string;
  viewport: { width: number; height: number };
  /** The part of the viewport that's recorded. */
  clip: Clip;
  /** The GIF's width in pixels (600 by default). */
  width?: number;
  /**
   * Before the page opens: stub the API (mockApis), for anything production
   * can't answer, and sign in through the test flags (signIn) for screens
   * only a signed-in account or an owner sees.
   */
  setup?(page: Page): Promise<void>;
  /** Once it's open, before recording: wait for it to settle. */
  ready?(page: Page): Promise<void>;
  /** What's recorded: page.mouse and page.keyboard steps, with pauses. */
  run(page: Page): Promise<void>;
}

// What these need of Playwright's BrowserContext and Page: a context or page
// passes as is.
interface Context {
  addInitScript(script: () => void): Promise<unknown>;
}
/** A frame of Chromium's screencast (Page.screencastFrame). */
export interface ScreencastFrame {
  /** The image, base64. */
  data: string;
  sessionId: number;
  /** deviceWidth: the viewport's width in CSS pixels; timestamp: in seconds. */
  metadata: { deviceWidth: number; timestamp?: number };
}
interface Screencast {
  on(event: 'Page.screencastFrame', listener: (frame: ScreencastFrame) => void): unknown;
  send(method: string, params?: object): Promise<unknown>;
  detach(): Promise<void>;
}
interface Recordable<Self> {
  context(): { newCDPSession(page: Self): Promise<Screencast> };
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/** Id of the layer the pointer is drawn on. */
export const POINTER_LAYER_ID = 'pr-gif-pointer';
/** How long the pointer may rest outside the clip before stop() warns. */
const OFF_FRAME_MS = 500;

/**
 * Draws the pointer and the keys pressed on every page `context` opens. Call
 * it before the first page loads: it's an init script.
 */
export async function showPointer(context: Context): Promise<void> {
  await context.addInitScript(drawPointer);
}

/**
 * Runs in the page (serialized by addInitScript, so it can't use anything
 * from this module's scope): adds a layer over the page, once the DOM is
 * there, that follows the pointer and the keyboard. pointer-events:none, so
 * it can never change what the page does, and every listener is on window's
 * capture phase, so the page can't stop it seeing an event. Where the pointer
 * is goes on window.__prGifPointer, for recordFrames to check the framing.
 */
export function drawPointer(): void {
  const layerId = 'pr-gif-pointer'; // POINTER_LAYER_ID, which this can't see
  const red = '#e11d48';
  const start = () => {
    if (document.getElementById(layerId)) return;
    const layer = document.createElement('div');
    layer.id = layerId;
    layer.style.cssText =
      'position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden';

    // The ring goes under the arrow, so the arrow's tip stays visible.
    const ring = document.createElement('div');
    ring.dataset.part = 'ring';
    ring.style.cssText = `position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;box-sizing:border-box;border:3px solid ${red};border-radius:50%;background:rgba(225,29,72,.18);opacity:0;transform:scale(.4)`;

    // An arrow, black with a white edge, its tip at (1, 1).
    const arrow = document.createElement('div');
    arrow.dataset.part = 'arrow';
    arrow.style.cssText =
      'position:absolute;left:0;top:0;width:22px;height:24px;transform:translate(-100px,-100px);filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))';
    arrow.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="24" viewBox="0 0 22 24"><path d="M1 1 L1 19 L5.6 14.6 L8.8 21.6 L12.2 20.1 L9 13.2 L15.4 13.2 Z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';

    // Which way the wheel scrolls, beside the pointer.
    const wheel = document.createElement('div');
    wheel.dataset.part = 'wheel';
    wheel.style.cssText = `position:absolute;left:0;top:0;width:28px;height:28px;margin:16px 0 0 14px;border-radius:50%;background:${red};color:#fff;font:700 17px/28px system-ui,sans-serif;text-align:center;opacity:0;transition:opacity 150ms ease-out`;

    // The key pressed, or the text being typed, at the bottom centre of the
    // recorded area (window.__prGifClip, from recordFrames), or else of the
    // window.
    const keys = document.createElement('div');
    keys.dataset.part = 'keys';
    keys.style.cssText =
      'position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:80%;overflow:hidden;white-space:pre;text-overflow:ellipsis;padding:5px 12px;border-radius:8px;background:rgba(17,24,39,.88);color:#fff;font:600 15px/20px system-ui,sans-serif;opacity:0;transition:opacity 150ms ease-out';

    layer.append(ring, arrow, wheel, keys);
    document.documentElement.append(layer);

    // Where the pointer was before a page load (a click that navigates, a
    // reload), so the arrow doesn't vanish until the next move.
    const SAVED = 'prGif:pointer';
    const at = { x: -100, y: -100, known: false };
    try {
      const saved = JSON.parse(sessionStorage.getItem(SAVED) ?? 'null') as {
        x: number;
        y: number;
      } | null;
      if (saved) {
        at.x = saved.x;
        at.y = saved.y;
        at.known = true;
      }
    } catch {
      // No storage (an opaque origin), or not ours: start off the page.
    }
    (window as unknown as { __prGifPointer: typeof at }).__prGifPointer = at;
    let down = false;
    let wheelDone: ReturnType<typeof setTimeout> | undefined;
    let keysDone: ReturnType<typeof setTimeout> | undefined;
    let typing = false;

    const place = () => {
      arrow.style.transform = `translate(${at.x - 1}px, ${at.y - 1}px)`;
      ring.style.left = `${at.x}px`;
      ring.style.top = `${at.y}px`;
      wheel.style.left = `${at.x}px`;
      wheel.style.top = `${at.y}px`;
    };
    if (at.known) place();

    // A drag leaves a trail: a dot that fades out where the pointer was.
    const dot = () => {
      const d = document.createElement('div');
      d.dataset.part = 'trail';
      d.style.cssText = `position:absolute;left:${at.x}px;top:${at.y}px;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:${red};opacity:.85;transition:opacity 600ms linear`;
      layer.insertBefore(d, arrow);
      setTimeout(() => {
        d.style.opacity = '0';
      }, 20);
      setTimeout(() => d.remove(), 650);
    };

    const move = (e: PointerEvent) => {
      at.x = e.clientX;
      at.y = e.clientY;
      at.known = true;
      place();
      if (down) dot();
      try {
        sessionStorage.setItem(SAVED, JSON.stringify({ x: at.x, y: at.y }));
      } catch {
        // As above.
      }
    };
    // The ring shows at once, so even a short press is in a frame, and fades
    // slowly once the button's up.
    const press = (e: PointerEvent) => {
      move(e);
      down = true;
      ring.style.transition = 'none';
      ring.style.opacity = '1';
      ring.style.transform = 'scale(1)';
    };
    const release = () => {
      down = false;
      ring.style.transition = 'opacity 350ms ease-out, transform 350ms ease-out';
      ring.style.opacity = '0';
      ring.style.transform = 'scale(1.6)';
    };
    const scroll = (e: WheelEvent) => {
      const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      wheel.textContent = across ? (e.deltaX > 0 ? '→' : '←') : e.deltaY > 0 ? '↓' : '↑';
      wheel.style.opacity = '1';
      clearTimeout(wheelDone);
      wheelDone = setTimeout(() => {
        wheel.style.opacity = '0';
      }, 400);
    };

    const NAMES: Record<string, string> = {
      ArrowLeft: '←',
      ArrowRight: '→',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ' ': 'Space',
      Escape: 'Esc',
    };
    const key = (e: KeyboardEvent) => {
      // A modifier on its own says nothing until a key goes with it.
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const chord = e.ctrlKey || e.altKey || e.metaKey;
      if (e.key.length === 1 && (e.key !== ' ' || typing) && !chord) {
        // Typing: the text builds up while the keys keep coming, spaces
        // included. A space on its own is a key press.
        keys.textContent = typing ? `${keys.textContent ?? ''}${e.key}` : e.key;
        typing = true;
      } else {
        const held = [
          e.ctrlKey && 'Ctrl',
          e.altKey && 'Alt',
          e.metaKey && 'Cmd',
          e.shiftKey && 'Shift',
        ].filter(Boolean);
        const name = NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
        keys.textContent = [...held, name].join('+');
        typing = false;
      }
      const clip = (
        window as unknown as {
          __prGifClip?: { x: number; y: number; width: number; height: number };
        }
      ).__prGifClip;
      keys.style.left = clip ? `${clip.x + clip.width / 2}px` : '50%';
      keys.style.bottom = clip ? `${innerHeight - (clip.y + clip.height) + 16}px` : '16px';
      keys.style.opacity = '1';
      clearTimeout(keysDone);
      keysDone = setTimeout(() => {
        keys.style.opacity = '0';
        typing = false;
      }, 600);
    };

    const capture = { capture: true, passive: true };
    window.addEventListener('pointermove', move, capture);
    window.addEventListener('pointerdown', press, capture);
    window.addEventListener('pointerup', release, capture);
    window.addEventListener('pointercancel', release, capture);
    window.addEventListener('wheel', scroll, capture);
    window.addEventListener('keydown', key, capture);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

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

// What the moves below need of a Page: a page passes as is.
interface Mouse {
  move(x: number, y: number): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}
type Driven = { mouse: Pick<Mouse, 'move'> };
type Target = Pick<Locator, 'boundingBox'> | Point;

/** How long the moves below wait between the events they send. */
export const STEP_MS = 16;

/** Eases 0..1 in and out; anything outside is held at its end. */
export function smoothstep(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Calls `step` with the eased progress, 0 to 1, every STEP_MS for `ms`, and
 * once more at 1. By the clock rather than a count of steps: a scripted move
 * of N steps is sent in a few milliseconds, and while frames are being taken
 * each one slows, so either way the recording would catch it in one or two
 * places.
 */
async function overTime(ms: number, step: (progress: number) => Promise<void>): Promise<void> {
  const start = performance.now();
  for (;;) {
    const t = ms > 0 ? (performance.now() - start) / ms : 1;
    await step(smoothstep(t));
    if (t >= 1) return;
    await wait(STEP_MS);
  }
}

// Where each page's pointer was last put, for the next move to start from.
// The same Page across a page load, so it outlives one.
const pointers = new WeakMap<object, Point>();

async function pointOf(target: Target): Promise<Point> {
  if (!('boundingBox' in target)) return target;
  const box = await target.boundingBox();
  if (!box) throw new Error('glide: the target has no box (is it on the page?)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Moves the pointer to the middle of `target` (or to a point) over `ms`,
 * easing in and out from where it last was, so the drawn arrow glides there
 * rather than jumping. The first move of a page, or one of 0 ms, puts it
 * straight there.
 */
export async function glide(page: Driven, target: Target, ms = 500): Promise<Point> {
  const to = await pointOf(target);
  const from = pointers.get(page) ?? to;
  await overTime(ms, (e) =>
    page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e),
  );
  pointers.set(page, to);
  return to;
}

/**
 * A click as a person makes it: glides to `target`, pauses, and holds the
 * button long enough for the drawn ring to be in a frame. Never
 * locator.click(), which sends no moves and a press of no time at all.
 */
export async function click(
  page: { mouse: Pick<Mouse, 'move' | 'down' | 'up'> },
  target: Target,
  { ms = 500, holdMs = 200 }: { ms?: number; holdMs?: number } = {},
): Promise<Point> {
  const at = await glide(page, target, ms);
  await wait(150);
  await page.mouse.down();
  await wait(holdMs);
  await page.mouse.up();
  return at;
}

/** A drag from `from` to `to`, over `ms`, holding a moment at either end. */
export async function drag(
  page: { mouse: Pick<Mouse, 'move' | 'down' | 'up'> },
  from: Target,
  to: Target,
  ms = 800,
): Promise<void> {
  await glide(page, from);
  await page.mouse.down();
  await wait(250);
  await glide(page, to, ms);
  await wait(250);
  await page.mouse.up();
}

/**
 * Turns the wheel `dy` pixels (down when positive) over `ms`, a little at a
 * time, so the page glides rather than leaping in one event, and the drawn
 * ↓/↑ stays up all the while. Glide the pointer over what scrolls first.
 */
export async function scroll(
  page: { mouse: Pick<Mouse, 'wheel'> },
  dy: number,
  ms = 700,
): Promise<void> {
  let done = 0;
  await overTime(ms, async (e) => {
    const target = Math.round(dy * e);
    if (target === done) return;
    await page.mouse.wheel(0, target - done);
    done = target;
  });
}

/** A frame's file name: f0000.png, f0001.png, … */
export function frameName(n: number): string {
  return `f${String(n).padStart(4, '0')}.png`;
}

/** What recordFrames notes about a recording, in its directory's timing.json. */
export interface Timing {
  clip: Clip;
  /** The clip in the frames' own pixels, which take in the whole viewport. */
  crop: Clip;
  /** When each frame was painted, in ms from the start. */
  times: number[];
  /** Where the pointer was, looked up every POINTER_EVERY_MS. */
  pointer: { times: number[]; at: (Point | null)[] };
  /** When the recording stopped, in ms from the start. */
  end: number;
}

/**
 * The stretches, in ms, where the pointer rested outside `clip` for longer
 * than `minMs`: it vanishes from the GIF there. A pointer that hasn't moved
 * yet (null) isn't anywhere.
 */
export function offFrame(
  times: readonly number[],
  pointer: readonly (Point | null)[],
  clip: Clip,
  minMs = OFF_FRAME_MS,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from: number | null = null;
  const close = (to: number) => {
    if (from !== null && to - from > minMs) out.push({ from, to });
    from = null;
  };
  pointer.forEach((p, i) => {
    const outside =
      p !== null &&
      (p.x < clip.x || p.y < clip.y || p.x >= clip.x + clip.width || p.y >= clip.y + clip.height);
    if (outside) from ??= times[i];
    else close(times[i]);
  });
  if (times.length > 0) close(times[times.length - 1]);
  return out;
}

/** How often recordFrames looks up where the pointer is. */
export const POINTER_EVERY_MS = 100;
/** How long recordFrames waits for the screencast's first frame. */
export const FIRST_FRAME_MS = 5000;

/** The width and height of a PNG, from its header. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** `clip`, in CSS pixels, in the pixels of a frame `scale` times as wide. */
export function cropOf(clip: Clip, scale: number): Clip {
  const px = (n: number) => Math.round(n * scale);
  return { x: px(clip.x), y: px(clip.y), width: px(clip.width), height: px(clip.height) };
}

/**
 * Records the page into `dir` (emptied first) until the returned stop() is
 * called: every frame Chromium paints, through its screencast, which sends
 * one for each change on screen without holding the page up, so motion
 * comes out at 15-25 frames a second where screenshots managed 2-5. Each
 * frame's time, the clip within the frames, and where the pointer was go in
 * dir/timing.json, for framesToGif to play the frames at the speed they were
 * painted. stop() waits for the last frame, warns (and says in `warnings`)
 * when the pointer rested outside the clip, and says how many frames there
 * were and how many a second.
 */
export function recordFrames<P extends Recordable<P>>(
  page: P,
  clip: Clip,
  dir: string,
): () => Promise<{ frames: number; fps: number; warnings: string[] }> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const started = performance.now();
  // As they arrive, which can be a little out of order; numbered by when
  // they were painted once it's stopped.
  const arrived: { file: string; time: number }[] = [];
  let scale = 1;
  // The page's clock (seconds) to ours (ms from the start), from the first.
  let offset: number | null = null;
  let first: () => void = () => {};
  const firstFrame = new Promise<void>((done) => (first = done));
  const pointer: Timing['pointer'] = { times: [], at: [] };
  let recording = true;

  const session = (async () => {
    // Where the key labels go: inside what's recorded.
    await page.evaluate((c: Clip) => {
      (window as unknown as { __prGifClip: Clip }).__prGifClip = c;
    }, clip);
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', (frame) => {
      const now = performance.now() - started;
      const png = Buffer.from(frame.data, 'base64');
      const stamp = frame.metadata.timestamp;
      if (arrived.length === 0) {
        scale = pngSize(png).width / frame.metadata.deviceWidth;
        if (stamp !== undefined) offset = now - stamp * 1000;
      }
      const file = `arrived-${arrived.length}.png`;
      writeFileSync(join(dir, file), png);
      arrived.push({
        file,
        time: stamp !== undefined && offset !== null ? stamp * 1000 + offset : now,
      });
      first();
      // Unacknowledged, it sends no more.
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    return cdp;
  })();

  const lookups = (async () => {
    await session;
    while (recording) {
      const time = performance.now() - started;
      const at = await page.evaluate(() => {
        const p = (window as unknown as { __prGifPointer?: Point & { known: boolean } })
          .__prGifPointer;
        return p?.known ? { x: p.x, y: p.y } : null;
      }, undefined);
      pointer.times.push(time);
      pointer.at.push(at);
      await wait(POINTER_EVERY_MS);
    }
  })();
  // A failure surfaces from stop(), not as an unhandled rejection.
  session.catch(() => {});
  lookups.catch(() => {});

  return async () => {
    recording = false;
    const cdp = await session;
    // The screencast's first frame is the page as it was: at least that one.
    await Promise.race([
      firstFrame,
      wait(FIRST_FRAME_MS).then(() => {
        throw new Error(`recordFrames: no frame came in ${FIRST_FRAME_MS / 1000} s`);
      }),
    ]);
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
    await lookups;
    const end = performance.now() - started;
    const ordered = [...arrived].sort((a, b) => a.time - b.time);
    ordered.forEach(({ file }, i) => renameSync(join(dir, file), join(dir, frameName(i))));
    const times = ordered.map(({ time }) => Math.max(0, time));
    const timing: Timing = { clip, crop: cropOf(clip, scale), times, pointer, end };
    writeFileSync(join(dir, 'timing.json'), JSON.stringify(timing));
    const warnings = offFrame(pointer.times, pointer.at, clip).map(
      ({ from, to }) =>
        `pr-gif: the pointer was outside the recorded area for ${((to - from) / 1000).toFixed(1)} s, from ${(from / 1000).toFixed(1)} s; it won't show there`,
    );
    for (const warning of warnings) console.warn(warning);
    const frames = times.length;
    return { frames, fps: end > 0 ? frames / (end / 1000) : 0, warnings };
  };
}

/**
 * The frames worth keeping, as [first, last] indexes: from a little before
 * the first change (`leadMs`) to a little after the last (`tailMs`), so the
 * GIF doesn't open or close on a long still, but keeps a short one as a
 * pause before it loops. `hashes` tell frames apart.
 */
export function activeRange(
  hashes: readonly string[],
  times: readonly number[],
  { leadMs = 500, tailMs = 1500 }: { leadMs?: number; tailMs?: number } = {},
): [number, number] {
  const n = hashes.length;
  if (n === 0) return [0, -1];
  const firstChange = hashes.findIndex((h) => h !== hashes[0]);
  if (firstChange === -1) return [0, n - 1];
  // The last frame that still differs from where it ends, and the one after
  // it, where it got there.
  let lastChange = n - 1;
  while (hashes[lastChange] === hashes[n - 1]) lastChange -= 1;
  const settled = lastChange + 1;
  let first = firstChange;
  while (first > 0 && times[firstChange] - times[first - 1] <= leadMs) first -= 1;
  let last = settled;
  while (last < n - 1 && times[last + 1] - times[settled] <= tailMs) last += 1;
  return [first, last];
}

/**
 * The frames `first`..`last` of a recording to show, each for as long as it
 * really lasted. A frame identical to the one before (`hashes`) only
 * lengthens it, which drops the stills without losing how long they held.
 * None is held longer than it was on screen: over content that moves, that
 * would show as a stutter. The pause the GIF ends on is the scenario's own
 * (activeRange keeps up to 1.5 s of it).
 */
export function shownFrames(
  times: readonly number[],
  end: number,
  [first, last]: [number, number],
  hashes: readonly string[] = [],
): { frame: number; ms: number }[] {
  const shown: { frame: number; ms: number }[] = [];
  for (let i = first; i <= last; i++) {
    const until = i + 1 < times.length ? times[i + 1] : end;
    const previous = shown[shown.length - 1];
    if (previous && hashes[i] !== undefined && hashes[i] === hashes[previous.frame]) {
      previous.ms += until - times[i];
    } else {
      shown.push({ frame: i, ms: until - times[i] });
    }
  }
  return shown;
}

/**
 * An ffconcat list of those frames. Each image is read at 100 fps, or the
 * demuxer would round every duration to its default 25 fps (40 ms steps);
 * GIFs count in 10 ms. The last frame is listed twice, since the demuxer
 * ignores the very last entry's duration.
 */
export function concatList(shown: readonly { frame: number; ms: number }[]): string {
  const lines = ['ffconcat version 1.0'];
  const entry = (frame: number) => [`file '${frameName(frame)}'`, 'option framerate 100'];
  for (const { frame, ms } of shown) {
    lines.push(...entry(frame), `duration ${(ms / 1000).toFixed(3)}`);
  }
  const final = shown[shown.length - 1];
  if (final) lines.push(...entry(final.frame));
  return `${lines.join('\n')}\n`;
}

/** ffmpeg's crop to `crop`, then on to the next filter; none for none. */
export function cropFilter(crop?: Clip): string {
  return crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '';
}

// One palette for the whole clip, and only the area that changed rewritten
// per frame.
const PALETTE =
  'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';

/**
 * The ffmpeg arguments for a GIF `width` wide from a concat list (see
 * concatList; `-safe 0` for its `option` lines, which name only our own
 * frames): cut to the clip (`crop`, in the frames' pixels), scaled down,
 * looping. Repeats
 * are already merged in the list; ffmpeg's mpdecimate would drop the still
 * the GIF ends on too, and with it the pause before it loops.
 */
export function gifArgs(list: string, out: string, width = 600, crop?: Clip): string[] {
  return [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    `${cropFilter(crop)}scale=${width}:-1:flags=lanczos,${PALETTE}`,
    '-fps_mode',
    'vfr',
    '-loop',
    '0',
    out,
  ];
}

/**
 * The ffmpeg arguments for a GIF `width` wide from frames numbered
 * f0000.png on, at a steady `fps`: for frames recorded some other way, with
 * no timing.json.
 */
export function steadyGifArgs(dir: string, out: string, width = 600, fps = 10): string[] {
  return [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(fps),
    '-i',
    join(dir, 'f%04d.png'),
    '-vf',
    `scale=${width}:-1:flags=lanczos,${PALETTE}`,
    '-loop',
    '0',
    out,
  ];
}

function readTiming(dir: string): Timing | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'timing.json'), 'utf8')) as Timing;
  } catch {
    return null;
  }
}

function hashFrames(dir: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    createHash('sha1')
      .update(readFileSync(join(dir, frameName(i))))
      .digest('hex'),
  );
}

/**
 * Writes the trimmed concat list for `dir`'s recording, and says how long it
 * plays for in ms.
 */
function writeList(
  dir: string,
  timing: Timing,
  name: string,
): { list: string; ms: number; crop?: Clip } {
  const hashes = hashFrames(dir, timing.times.length);
  const range = activeRange(hashes, timing.times);
  const shown = shownFrames(timing.times, timing.end, range, hashes);
  const list = join(dir, name);
  writeFileSync(list, concatList(shown));
  return { list, ms: shown.reduce((sum, { ms }) => sum + ms, 0), crop: timing.crop };
}

/**
 * Turns `dir`'s frames into the GIF `out`, `width` wide, with the system's
 * ffmpeg: at the speed they were recorded, from dir/timing.json, or else at
 * a steady `fps`.
 */
export function framesToGif(
  dir: string,
  out: string,
  { width = 600, fps = 10 }: { width?: number; fps?: number } = {},
): void {
  mkdirSync(dirname(out), { recursive: true });
  const timing = readTiming(dir);
  let args;
  if (timing) {
    const { list, crop } = writeList(dir, timing, 'frames.ffconcat');
    args = gifArgs(list, out, width, crop);
  } else {
    args = steadyGifArgs(dir, out, width, fps);
  }
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

/**
 * The ffmpeg arguments that join two recordings into one GIF `width` wide:
 * each labelled above, the shorter held on its last frame until the longer
 * ends, so they play in step from the start.
 */
export function sideBySideArgs(
  before: { list: string; ms: number; crop?: Clip },
  after: { list: string; ms: number; crop?: Clip },
  out: string,
  width = 1000,
): string[] {
  const longest = Math.max(before.ms, after.ms);
  const half = Math.floor((width - 12) / 2);
  const panel = (
    input: number,
    label: string,
    { ms, crop }: { ms: number; crop?: Clip },
    pad: string,
  ) =>
    `[${input}:v]${cropFilter(crop)}fps=25,scale=${half}:-1:flags=lanczos,` +
    `tpad=stop_mode=clone:stop_duration=${((longest - ms) / 1000).toFixed(3)},` +
    `pad=${pad}:white,` +
    `drawtext=text=${label}:font=sans:fontsize=22:fontcolor=0x111827:x=12:y=10[${label}]`;
  return [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    before.list,
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    after.list,
    '-filter_complex',
    [
      // 12px between the two, and a 44px band above each for its label.
      panel(0, 'Before', before, 'iw+12:ih+44:0:44'),
      panel(1, 'After', after, 'iw:ih+44:0:44'),
      `[Before][After]hstack=inputs=2,${PALETTE}`,
    ].join(';'),
    '-fps_mode',
    'vfr',
    '-loop',
    '0',
    out,
  ];
}

/**
 * Joins two recordings (directories recordFrames wrote) into the GIF `out`,
 * "Before" on the left and "After" on the right, playing in step.
 */
export function sideBySide(
  beforeDir: string,
  afterDir: string,
  out: string,
  { width = 1000 }: { width?: number } = {},
): void {
  const before = readTiming(beforeDir);
  const after = readTiming(afterDir);
  if (!before || !after) throw new Error('sideBySide: both recordings need their timing.json');
  mkdirSync(dirname(out), { recursive: true });
  const args = sideBySideArgs(
    writeList(beforeDir, before, 'side.ffconcat'),
    writeList(afterDir, after, 'side.ffconcat'),
    out,
    width,
  );
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}
