import { apolloClient } from './apolloClient';
import { FIND_SHARED_PLACES } from './gqlDocs';
import type { DuplicateMatch } from './duplicates';

// Sharing an Instagram post or reel to the app (#6): /share?url=… (from the
// iPhone Shortcut or the Android share sheet, which may put the link in
// `text`), or a link pasted on the page. The server reads the post and finds
// its places (findSharedPlaces); the page drafts the ones picked.

export type SharedPlaceSource = 'caption' | 'on_screen' | 'spoken' | 'geotag' | 'picture' | 'hint';

export interface SharedPlace {
  name: string;
  city: string;
  lat: number;
  lng: number;
  detail: string | null;
  source: SharedPlaceSource;
  saved: DuplicateMatch | null;
}

export interface SharedPost {
  url: string;
  author: string | null;
  caption: string | null;
  imageUrl: string | null;
  isVideo: boolean | null;
}

export interface SharedPlaces {
  post: SharedPost;
  places: SharedPlace[];
  read: { caption: boolean; video: boolean; geotag: boolean };
}

// What's been found this session, by post and hint, so coming back to the
// page (a reload, Back) shows it again rather than paying to read it again.
const CACHE_PREFIX = 'shared-places:';

function cached(key: string): SharedPlaces | null {
  try {
    const stored = sessionStorage.getItem(CACHE_PREFIX + key);
    if (stored) return JSON.parse(stored) as SharedPlaces;
  } catch {
    // Blocked, or not what was kept: it's read again.
  }
  return null;
}

function remember(key: string, found: SharedPlaces) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(found));
  } catch {
    // Full or blocked: it's read again next time.
  }
}

export async function findSharedPlaces(url: string, hint = ''): Promise<SharedPlaces> {
  const key = `${url}\n${hint.trim()}`;
  const known = cached(key);
  if (known) return known;
  const { data } = await apolloClient.mutate({
    mutation: FIND_SHARED_PLACES,
    variables: { url, hint: hint.trim() || null },
  });
  const found = data?.findSharedPlaces;
  if (!found) throw new Error("Couldn't read the post");
  const places: SharedPlaces = {
    post: found.post,
    read: found.read,
    places: found.places.map((p) => ({
      name: p.name,
      city: p.city,
      lat: p.lat,
      lng: p.lng,
      detail: p.detail ?? null,
      source: p.source,
      saved: p.saved ?? null,
    })),
  };
  remember(key, places);
  return places;
}

// A link to an Instagram post or reel, as the server reads one: on
// instagram.com, maybe after the account's name.
const INSTAGRAM_POST =
  /https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]{5,64}[^\s<>"']*/i;

/** The first link to an Instagram post or reel in `text`. */
export function instagramLink(text: string): string | null {
  return INSTAGRAM_POST.exec(text)?.[0] ?? null;
}

/**
 * The post a share passed: the first Instagram link in its `url`, `text` or
 * `title` (Android puts a shared link in `text`, sometimes inside a
 * sentence).
 */
export function sharedLink(params: URLSearchParams): string | null {
  for (const key of ['url', 'text', 'title']) {
    const link = instagramLink(params.get(key) ?? '');
    if (link) return link;
  }
  return null;
}

/** A post known only by its link, for a place added by hand before it's read. */
export function bareSharedPost(url: string): SharedPost {
  return { url, author: null, caption: null, imageUrl: null, isVideo: null };
}

/** Where in the post a place was found, as the page says it. */
export const SOURCE_LABEL: Record<SharedPlaceSource, string> = {
  caption: 'in the caption',
  on_screen: 'on screen',
  spoken: 'said in the video',
  geotag: 'its location tag',
  picture: 'in the picture',
  hint: 'your hint',
};

/**
 * What a picked place is drafted from: its name and city as the title, and
 * the post in the notes, so the draft knows what it was about. Kept within
 * the draft's limits (#73): the post's link is the notes' only link.
 */
export function draftSeed(place: SharedPlace, post: SharedPost): { title: string; notes: string } {
  const lines = [`From an Instagram ${post.isVideo ? 'reel' : 'post'}${post.author ? ` by @${post.author}` : ''}: ${post.url}`];
  if (place.detail) lines.push(`What it says about ${place.name}: ${place.detail}`);
  if (post.caption) {
    const caption = post.caption.replace(/https?:\/\/\S+/gi, '').trim().slice(0, 1200);
    if (caption) lines.push(`Caption: ${caption}`);
  }
  return { title: `${place.name}, ${place.city}`.slice(0, 200), notes: lines.join('\n\n') };
}

/** A draft for a place the post's list missed: just the post in the notes. */
export function postSeed(post: SharedPost): { title: string; notes: string } {
  return {
    title: '',
    notes: `From an Instagram ${post.isVideo ? 'reel' : 'post'}${post.author ? ` by @${post.author}` : ''}: ${post.url}`,
  };
}
