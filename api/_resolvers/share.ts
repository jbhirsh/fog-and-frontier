import { findDuplicates, normalizeName, type DuplicateMatch } from '../_duplicates.js';
import { badGateway, badInput } from '../_gqlError.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  fetchMedia,
  findInstagramUrl,
  readInstagramPost,
  type InstagramPost,
  type ReadSteps,
} from '../_instagram.js';
import { logEvent, logServerError } from '../_log.js';
import { catalogPlaces } from './catalog.js';
import { ENDPOINT, jsonConfig, responseText } from './gemini.js';

// The places in a shared Instagram post or reel (#6): read the post
// (api/_instagram.ts), hand Gemini what it gave — caption, picture, video,
// geotag — with the user's hint, and have it name every place the post
// features, each checked with Google Search. The page then drafts the ones
// the user picks with generateActivity, one at a time.
//
// Robust by construction: each Instagram source is on its own time limit,
// and a post read from either still gets an answer (the embed page alone
// gives its caption and picture); one that gives nothing gets an empty list
// (the page asks for a hint) without a call to Gemini. Which sources
// answered is logged with each call.

const ROUTE = '/api/graphql';

/** At most this many places from one post. */
export const MAX_PLACES = 10;
/** The longest hint a user may add. */
export const MAX_HINT = 300;
/** The longest caption sent to Gemini (Instagram allows 2,200 characters). */
export const MAX_CAPTION = 2400;
/** How long Gemini may take to watch a reel and search for its places. */
export const GEMINI_TIMEOUT_MS = 120_000;
/** No further video is tried once this long has gone on media. */
export const MEDIA_BUDGET_MS = 20_000;
/**
 * Google Search, to check each place, but not URL reading: the caption is a
 * stranger's text, and the only link is the post, which Gemini can't open.
 */
const PLACES_TOOLS = [{ googleSearch: {} }];

export const PLACE_SOURCES = ['caption', 'on_screen', 'spoken', 'geotag', 'picture', 'hint'] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

export interface SharedPlace {
  name: string;
  city: string;
  lat: number;
  lng: number;
  detail: string | null;
  source: PlaceSource;
  saved: DuplicateMatch | null;
}

const PLACES_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "The place's proper name" },
          city: { type: 'string', description: 'The city or town it is in or nearest to' },
          lat: { type: 'number' },
          lng: { type: 'number' },
          detail: {
            type: 'string',
            description: 'One line, in your own words, on what the post says about it',
          },
          source: { type: 'string', enum: PLACE_SOURCES },
        },
        required: ['name', 'city', 'lat', 'lng', 'source'],
      },
    },
  },
  required: ['places'],
};

const PLACES_SYSTEM_PROMPT = `You find the places featured in an Instagram post or reel, for a personal West Coast adventures app that saves places to visit: trails, parks, beaches, viewpoints, restaurants, cafés, venues and the like.

You are given what could be read of the post: its caption, its author, Instagram's description of its picture, its geotag, the picture and the video when attached, and maybe a hint from the user. Watch the video for places shown in on-screen text or named aloud.

Rules:
- List each distinct real place the post recommends or shows that someone could go to, in the order the post presents them, at most ${MAX_PLACES}.
- Use Google Search to confirm each place exists and to find its city and coordinates. The geotag is often imprecise or wrong: prefer the place's own location.
- Leave out the author's account, brands and products, and whole cities or regions, unless the post is about visiting that city or region as a whole.
- If the user's hint names a place, include it, with source "hint".
- source says where you found the place: "caption", "on_screen" (text in the video or picture), "spoken" (said in the video), "geotag", "picture" (recognised in the picture) or "hint".
- If the post names no place you can find, return an empty list rather than guess.`;

/** The text Gemini is given about the post. */
export function placesPrompt(
  post: InstagramPost,
  hint: string,
  attached: { image: boolean; video: boolean },
): string {
  const lines = [
    `Instagram ${post.isVideo ? 'reel' : 'post'}${post.author ? ` by @${post.author}` : ''}: ${post.url}`,
  ];
  if (post.caption) lines.push(`Caption:\n${post.caption.slice(0, MAX_CAPTION)}`);
  if (post.imageDescription) {
    lines.push(`Instagram's description of the picture: ${post.imageDescription}`);
  }
  if (post.geotag) {
    lines.push(`Geotag (may be imprecise): ${post.geotag.name} (${post.geotag.lat}, ${post.geotag.lng})`);
  }
  if (hint) lines.push(`The user's hint: ${hint}`);
  const media = [attached.video && 'the video', attached.image && 'the picture'].filter(Boolean);
  if (media.length > 0) lines.push(`Attached: ${media.join(' and ')}.`);
  return lines.join('\n\n');
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t !== '' && t.length <= max ? t : null;
};
const coord = (v: unknown, limit: number): number | null =>
  Number.isFinite(v) && Math.abs(v as number) <= limit ? (v as number) : null;

/**
 * Gemini's places, kept only if whole: a name, a city and real coordinates
 * (not 0, 0). A source it made up reads as the caption; a repeated name
 * keeps its first; at most MAX_PLACES.
 */
export function cleanPlaces(raw: unknown): Omit<SharedPlace, 'saved'>[] {
  const list = (raw as { places?: unknown } | null)?.places;
  if (!Array.isArray(list)) return [];
  const out: Omit<SharedPlace, 'saved'>[] = [];
  const names = new Set<string>();
  for (const item of list as (Record<string, unknown> | null)[]) {
    if (!item) continue;
    const name = text(item.name, 120);
    const city = text(item.city, 80);
    const lat = coord(item.lat, 90);
    const lng = coord(item.lng, 180);
    if (!name || !city || lat === null || lng === null || (lat === 0 && lng === 0)) continue;
    const key = normalizeName(name) || name;
    if (names.has(key)) continue;
    names.add(key);
    const source = (PLACE_SOURCES as readonly unknown[]).includes(item.source)
      ? (item.source as PlaceSource)
      : 'caption';
    out.push({ name, city, lat, lng, detail: text(item.detail, 300), source });
    if (out.length === MAX_PLACES) break;
  }
  return out;
}

/** Each place, with the saved activity it looks like (a high-confidence match), if any. */
export function markSaved(
  places: readonly Omit<SharedPlace, 'saved'>[],
  catalog: Parameters<typeof findDuplicates>[1],
): SharedPlace[] {
  return places.map((place) => ({
    ...place,
    saved: findDuplicates(place, catalog).find((m) => m.confidence === 'high') ?? null,
  }));
}

/**
 * The first media file at `urls` that fits in `maxBytes`, base64'd for
 * Gemini. Each try has its own time limit; none starts after `deadline`.
 */
async function firstMedia(urls: readonly string[], maxBytes: number, deadline: number) {
  for (const url of urls) {
    if (Date.now() >= deadline) break;
    const media = await fetchMedia(url, maxBytes);
    if (media) return { mimeType: media.mimeType, data: media.data.toString('base64') };
  }
  return null;
}

/** What the post page shows: the post as read, minus what only Gemini needs. */
function shownPost(post: InstagramPost) {
  return {
    url: post.url,
    author: post.author ?? null,
    caption: post.caption ?? null,
    imageUrl: post.imageUrl ?? null,
    isVideo: post.isVideo ?? null,
  };
}

async function findSharedPlaces(
  _parent: unknown,
  args: { url: string; hint?: string | null },
  ctx: GqlContext,
) {
  // Owners only: a paid Gemini call, and the places go into the catalog.
  requireOwnerCtx(ctx);
  const link = findInstagramUrl(args.url);
  if (!link) throw badInput("That isn't a link to an Instagram post or reel");
  const hint = (args.hint ?? '').trim();
  if (hint.length > MAX_HINT) throw badInput('hint is too long');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const { post, steps } = await readInstagramPost(link);
  // The video, or else the picture: both, base64'd, could pass Gemini's
  // 20 MB, and the video shows what the picture does.
  const deadline = Date.now() + MEDIA_BUDGET_MS;
  const video = post.videoUrls ? await firstMedia(post.videoUrls, MAX_VIDEO_BYTES, deadline) : null;
  const image =
    !video && post.imageUrl ? await firstMedia([post.imageUrl], MAX_IMAGE_BYTES, deadline) : null;
  const read = {
    caption: Boolean(post.caption),
    video: Boolean(video),
    geotag: Boolean(post.geotag),
  };
  const note = (fields: Record<string, unknown>) =>
    logEvent('share.places', {
      shortcode: post.shortcode,
      ...readSteps(steps),
      image: image ? 'ok' : video ? 'not needed' : post.imageUrl ? 'failed' : 'none',
      video: video ? 'ok' : post.videoUrls ? 'failed or too big' : post.isVideo ? 'not given' : 'none',
      geotag: read.geotag,
      ...fields,
    });

  // Nothing to read and nothing to go on: no call.
  if (!post.caption && !image && !video && !post.geotag && !hint) {
    note({ places: 0, gemini: 'skipped' });
    return { post: shownPost(post), places: [], read };
  }

  const parts: Record<string, unknown>[] = [
    { text: placesPrompt(post, hint, { image: Boolean(image), video: Boolean(video) }) },
  ];
  if (video) parts.push({ inlineData: video });
  if (image) parts.push({ inlineData: image });

  let r: Response;
  try {
    r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PLACES_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        tools: PLACES_TOOLS,
        generationConfig: jsonConfig(PLACES_SCHEMA, 'medium'),
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    note({ gemini: timedOut ? 'timed out' : 'unreachable' });
    logServerError(err, { route: ROUTE, method: 'POST', status: 502 });
    throw badGateway("Couldn't reach Gemini to read the post");
  }
  if (!r.ok) {
    note({ gemini: `HTTP ${r.status}` });
    logServerError(new Error(`gemini request failed: ${r.status}`), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: (await r.text()).slice(0, 500),
    });
    throw badGateway("Gemini couldn't read the post");
  }

  let json: unknown = null;
  try {
    const answer = responseText((await r.json()) as Parameters<typeof responseText>[0]);
    json = answer ? JSON.parse(answer) : null;
  } catch {
    // Unusable: no places.
  }
  const places = markSaved(cleanPlaces(json), await catalogPlaces());
  note({ places: places.length, gemini: json === null ? 'unusable' : 'ok' });
  return { post: shownPost(post), places, read };
}

/** The read steps as log fields. */
function readSteps(steps: ReadSteps) {
  return { embed: steps.embed, page: steps.page };
}

export const shareMutation = { findSharedPlaces };
