// Reading a shared Instagram post or reel (#6): what it says, who posted it,
// its picture, and, when Instagram gives them, its video and geotag, for
// Gemini to find the places in it.
//
// Two sources, each on its own time limit, and either may fail without
// failing the share:
//   1. The embed page (/p/<code>/embed/captioned/), which Instagram serves
//      for embedding posts on other sites: the caption, author, picture,
//      whether it's a video and how long. The steady source.
//   2. The post page itself, read as a browser that has just opened
//      instagram.com (with the cookies that visit sets): the video files and
//      the geotag. It's Instagram's own page data, which it can change at
//      any time; the weekly check (scripts/instagram-check.ts) says if it
//      does, and until it's fixed a share still reads the embed page.
// Nothing here throws for Instagram's sake: a source that fails is noted in
// `steps`, for the log, and the post is what the other one found.

/** A post's address, cut to the post: no account path, no tracking query. */
export interface InstagramLink {
  shortcode: string;
  url: string;
}

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const KINDS = new Set(['p', 'reel', 'reels', 'tv']);
const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/;

/**
 * The post `raw` links to, or null for anything that isn't an Instagram post
 * or reel: instagram.com/p/<code>, /reel/<code>, /reels/<code>, /tv/<code>,
 * with or without an account name before it, and any query (?igsh=…) or
 * fragment dropped.
 */
export function parseInstagramUrl(raw: string): InstagramLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.findIndex((p) => KINDS.has(p.toLowerCase()));
  // The kind is first, or second after an account name.
  if (at < 0 || at > 1) return null;
  const shortcode = parts[at + 1];
  if (!shortcode || !SHORTCODE.test(shortcode)) return null;
  const kind = parts[at].toLowerCase() === 'p' ? 'p' : 'reel';
  return { shortcode, url: `https://www.instagram.com/${kind}/${shortcode}/` };
}

/**
 * The first Instagram post linked in `text`: a share sheet may pass the link
 * alone, or inside a sentence ("Check out this reel https://…").
 */
export function findInstagramUrl(text: string): InstagramLink | null {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const link = parseInstagramUrl(match[0]);
    if (link) return link;
  }
  return null;
}

export interface InstagramPlaceTag {
  name: string;
  lat: number;
  lng: number;
}

/** What a post gave: anything Instagram didn't is left out. */
export interface InstagramPost {
  shortcode: string;
  url: string;
  caption?: string;
  author?: string;
  imageUrl?: string;
  isVideo?: boolean;
  durationSeconds?: number;
  /** Instagram's own description of the picture, when it has one. */
  imageDescription?: string;
  /** Its video files, smallest first. */
  videoUrls?: string[];
  geotag?: InstagramPlaceTag;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;
const num = (v: unknown): number | undefined => (Number.isFinite(v) ? (v as number) : undefined);

// A JS string literal's body, up to its closing quote: anything but a quote
// or backslash, or a backslash and the character it escapes.
const STRING_BODY = /((?:[^"\\]|\\[\s\S])*)"/y;

/** The JSON text of the JS string literal that starts at `html[from]` (after its quote). */
function stringLiteralAt(html: string, from: number): string | null {
  STRING_BODY.lastIndex = from;
  return STRING_BODY.exec(html)?.[1] ?? null;
}

/**
 * The post on an embed page: its `contextJSON`, a JSON document held in a
 * string, whose `gql_data.shortcode_media` is the post. Null when there's
 * none (a private or deleted post's embed page has no media).
 */
export function parseEmbedPage(html: string, link: InstagramLink): InstagramPost | null {
  const key = '"contextJSON":"';
  const at = html.indexOf(key);
  if (at < 0) return null;
  const raw = stringLiteralAt(html, at + key.length);
  if (raw === null) return null;
  let media: Record<string, unknown> | undefined;
  try {
    const context = JSON.parse(JSON.parse(`"${raw}"`) as string) as {
      gql_data?: { shortcode_media?: Record<string, unknown> };
    };
    media = context.gql_data?.shortcode_media;
  } catch {
    // Not the JSON it should be: no post.
  }
  if (!media || typeof media !== 'object') return null;
  const caption = (media.edge_media_to_caption as { edges?: { node?: { text?: unknown } }[] } | undefined)
    ?.edges?.[0]?.node?.text;
  const owner = media.owner as { username?: unknown } | undefined;
  const isVideo = typeof media.is_video === 'boolean' ? media.is_video : undefined;
  const videoUrl = str(media.video_url);
  return {
    ...link,
    caption: str(caption),
    author: str(owner?.username),
    imageUrl: str(media.display_url),
    isVideo,
    durationSeconds: num(media.video_duration),
    imageDescription: str(media.accessibility_caption),
    videoUrls: videoUrl ? [videoUrl] : undefined,
  };
}

/**
 * The post on its own page: the page's JSON data blocks, walked for the
 * media object whose `code` is the post's shortcode. Null when there's none
 * (a login page, or a layout this no longer knows).
 */
export function parsePostPage(html: string, link: InstagramLink): InstagramPost | null {
  let media: Record<string, unknown> | undefined;
  // Parsed JSON is a tree, so nothing is visited twice.
  const walk = (v: unknown) => {
    if (media || !v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.code === link.shortcode && ('caption' in o || 'video_versions' in o)) {
      media = o;
      return;
    }
    for (const child of Object.values(o)) walk(child);
  };
  for (const block of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      walk(JSON.parse(block[1]));
    } catch {
      // Not JSON after all: the next block.
    }
    if (media) break;
  }
  const found = media;
  if (!found) return null;
  const location = found.location as Record<string, unknown> | null | undefined;
  const lat = num(location?.lat);
  const lng = num(location?.lng);
  const name = str(location?.name);
  // Smallest last on the page; kept smallest first, the one to try first.
  const videos = Array.isArray(found.video_versions)
    ? (found.video_versions as { url?: unknown }[])
        .map((v) => str(v.url))
        .filter((u): u is string => u !== undefined)
        .reverse()
    : [];
  const candidates = (found.image_versions2 as { candidates?: { url?: unknown }[] } | undefined)
    ?.candidates;
  return {
    ...link,
    caption: str((found.caption as { text?: unknown } | null | undefined)?.text),
    author: str((found.user as { username?: unknown } | undefined)?.username),
    imageUrl: str(candidates?.[0]?.url),
    isVideo: videos.length > 0 || found.media_type === 2 ? true : undefined,
    imageDescription: str(found.accessibility_caption),
    videoUrls: videos.length > 0 ? videos : undefined,
    geotag: name && lat !== undefined && lng !== undefined ? { name, lat, lng } : undefined,
  };
}

/** The two readings of a post as one: the embed page's first, the post page's filling gaps. */
export function mergePosts(
  link: InstagramLink,
  embed: InstagramPost | null,
  page: InstagramPost | null,
): InstagramPost {
  const out: InstagramPost = { ...link };
  for (const source of [page, embed]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source) as [keyof InstagramPost, unknown][]) {
      if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  // The page's video files over the embed page's one, since they come in
  // sizes, smallest first.
  if (page?.videoUrls) out.videoUrls = page.videoUrls;
  return out;
}

/** What happened to each source, for the log: "ok", or why not. */
export interface ReadSteps {
  embed: string;
  page: string;
}

type Fetch = typeof fetch;

/** How long each source may take. */
export const SOURCE_TIMEOUT_MS = 8000;
/**
 * The largest picture and video read. A reel's smallest video is often about
 * 5 MB for a minute, but some are served only at a high bitrate (17.7 MB for
 * 26 seconds): findSharedPlaces sends Gemini one that fits inline, and
 * uploads a bigger one (api/_geminiFiles.ts).
 */
export const MAX_IMAGE_BYTES = 4_000_000;
export const MAX_VIDEO_BYTES = 60_000_000;
/** The largest video sent inline: base64'd, within Gemini's 20 MB per request. */
export const INLINE_VIDEO_BYTES = 14_000_000;

// The embed page answers anyone, so it's asked as what this is.
export const EMBED_HEADERS = {
  'user-agent': 'FogAndFrontier/1.0 (+https://fog-and-frontier.vercel.app)',
};
// The post page has its data in it only for a client that doesn't run
// JavaScript and has the cookies a first visit sets: a browser's agent, or
// none of those headers, gets the page that loads it later (tested Oct 2026).
export const PAGE_HEADERS = {
  'user-agent': 'curl/8.5.0',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-us,en;q=0.5',
  'sec-fetch-mode': 'navigate',
};

function why(err: unknown): string {
  // A time limit throws a DOMException, which isn't an Error everywhere.
  if ((err as { name?: unknown } | null)?.name === 'TimeoutError') return 'timed out';
  return err instanceof Error ? err.message : String(err);
}

/** Lets go of a response whose body won't be read, so its connection is freed. */
async function discard(r: Response): Promise<void> {
  await r.body?.cancel().catch(() => undefined);
}

async function readEmbed(link: InstagramLink, fetchImpl: Fetch): Promise<InstagramPost> {
  const r = await fetchImpl(`https://www.instagram.com/p/${link.shortcode}/embed/captioned/`, {
    headers: EMBED_HEADERS,
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!r.ok) {
    await discard(r);
    throw new Error(`HTTP ${r.status}`);
  }
  const post = parseEmbedPage(await r.text(), link);
  if (!post) throw new Error('no post on the embed page');
  return post;
}

/** The `name=value` pairs a response's Set-Cookie headers set. */
export function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('='))
    .join('; ');
}

async function readPage(link: InstagramLink, fetchImpl: Fetch): Promise<InstagramPost> {
  const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  // The cookies a first visit gets; without them the post page has no data.
  const home = await fetchImpl('https://www.instagram.com/', { headers: PAGE_HEADERS, signal });
  const cookie = cookiesFrom(home.headers);
  await discard(home);
  const r = await fetchImpl(link.url, {
    headers: { ...PAGE_HEADERS, ...(cookie ? { cookie } : {}) },
    signal,
  });
  if (!r.ok) {
    await discard(r);
    throw new Error(`HTTP ${r.status}`);
  }
  if (new URL(r.url || link.url).pathname.startsWith('/accounts/login')) {
    await discard(r);
    throw new Error('sent to the login page');
  }
  const post = parsePostPage(await r.text(), link);
  if (!post) throw new Error('no post data on the page');
  return post;
}

/**
 * A shared post, read from both sources at once. Never throws: when neither
 * answers, it's the bare link, and `steps` says why.
 */
export async function readInstagramPost(
  link: InstagramLink,
  fetchImpl: Fetch = fetch,
): Promise<{ post: InstagramPost; steps: ReadSteps }> {
  const [embed, page] = await Promise.allSettled([
    readEmbed(link, fetchImpl),
    readPage(link, fetchImpl),
  ]);
  return {
    post: mergePosts(
      link,
      embed.status === 'fulfilled' ? embed.value : null,
      page.status === 'fulfilled' ? page.value : null,
    ),
    steps: {
      embed: embed.status === 'fulfilled' ? 'ok' : why(embed.reason),
      page: page.status === 'fulfilled' ? 'ok' : why(page.reason),
    },
  };
}

/** Whether `url` is on Instagram's media servers, the only place media is fetched from. */
export function isInstagramMedia(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname.endsWith('.cdninstagram.com') || u.hostname.endsWith('.fbcdn.net'))
    );
  } catch {
    return false;
  }
}

/**
 * The bytes at `url` if it's Instagram media of at most `maxBytes`, read as
 * they come so a bigger file is dropped part-way rather than held whole.
 * Null for anything else, or any failure.
 */
export async function fetchMedia(
  url: string,
  maxBytes: number,
  fetchImpl: Fetch = fetch,
): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!isInstagramMedia(url)) return null;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS * 2) });
    if (!r.body) return null;
    // Wherever a redirect led, the file must still be Instagram's.
    if (!isInstagramMedia(r.url || url)) {
      await discard(r);
      return null;
    }
    const mimeType = (r.headers.get('content-type') ?? '').split(';')[0];
    if (!r.ok || !/^(image|video)\//.test(mimeType) || Number(r.headers.get('content-length')) > maxBytes) {
      await discard(r);
      return null;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = (r.body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return { data: Buffer.concat(chunks), mimeType };
  } catch {
    return null;
  }
}
