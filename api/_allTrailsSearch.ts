// A hike's AllTrails listing (#6), found by Gemini searching AllTrails
// itself. A draft's own Google Search often misses a hike AllTrails knows by
// another name: the first real share, Dragon Mountain Peak (Thiên Long Sơn)
// in Milpitas, is listed as "Dragon Mountain Stairs". So a hike's draft gets
// one more short exchange: Gemini, given the draft's facts, searches
// AllTrails' trail pages with `search_alltrails` (an Agent Search app that
// indexes www.alltrails.com/trail/* and nothing else) by as many names as it
// needs, then picks a trail with `choose_trail`. The page it picks is kept
// only if one of its searches returned it, so the link is a real trail page,
// never one Gemini made up.
//
// The caller sends the requests (`TrailTools`), so this file holds what to
// ask, what to keep and what to log. Never throws.

import { isSavableUrl, LINK_HOSTS } from './_links.js';
import { logEvent } from './_log.js';

export interface DraftedHike {
  name: string;
  city?: unknown;
  lat: number;
  lng: number;
  shortDescription?: unknown;
  longDescription?: unknown;
  /** The draft's own link, from its Google Search: a lead to check, not an answer. */
  allTrailsUrl?: unknown;
}

/** The Agent Search app that searches www.alltrails.com/trail/* alone. */
export const AGENT_SEARCH_URL =
  'https://discoveryengine.googleapis.com/v1/projects/gen-lang-client-0818068083/locations/global/collections/default_collection/engines/alltrails-search_1792884407396/servingConfigs/default_search:searchLite';

/** A request that was answered with an error status, and the start of what it said. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail = '',
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** The two requests a search makes, each resolving to its JSON or throwing. */
export interface TrailTools {
  /** Sends one generateContent request body to Gemini. */
  gemini(body: unknown): Promise<unknown>;
  /** Runs one query on the Agent Search app. */
  search(query: string): Promise<unknown>;
}

export const TRAIL_SEARCH_PROMPT = `You find a hike's listing on AllTrails. Given a place that was drafted as a hike, find the AllTrails trail most people hike there.

- Search with search_alltrails, which searches AllTrails' trail pages and nothing else. AllTrails lists trails, not places, often under a different name: search by every name the place goes by (its common English name and any local or translated one), by the routes and features its description mentions (for example "… Stairs", "… Trail", "… Loop"), and with the nearest town or park. Short queries work best.
- Then answer with choose_trail, giving the url of the result that is a trail at this place: its title and snippet should match the place's names or features, and its town or park. A trail elsewhere, even with a similar name, is a different trail.
- With it, give up to three other results that could be the trail meant, best first, for the person to choose from should your pick be wrong. Leave out any that are elsewhere.
- If no result is a trail at this place, call choose_trail without a url.`;

// Rounds of searching before Gemini must choose, searches in all, and
// other trails offered beside its pick.
export const MAX_ROUNDS = 3;
export const MAX_SEARCHES = 6;
export const MAX_OTHERS = 3;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'search_alltrails',
        description:
          "Searches AllTrails' trail pages. Returns up to 10 trails, each with its url, title and a snippet of its page.",
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'What to search for' } },
          required: ['query'],
        },
      },
      {
        name: 'choose_trail',
        description: 'Gives your answer: the trail at this place, from your search results.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: "The trail's url, exactly as a search returned it; omit if none matches",
            },
            others: {
              type: 'array',
              items: { type: 'string' },
              description: `Up to ${MAX_OTHERS} other results' urls that could be this trail, best first`,
            },
          },
        },
      },
    ],
  },
];

// A fact as given, trimmed; '' (left out) for anything but a string.
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** What Gemini is told of `hike`: its facts, one to a line. */
export function trailQuestion(hike: DraftedHike): string {
  const lead = trailPage(hike.allTrailsUrl);
  const lines = [
    `Place: ${hike.name}`,
    text(hike.city) && `Town: ${text(hike.city)}`,
    `Coordinates: ${hike.lat}, ${hike.lng}`,
    text(hike.shortDescription) && `Short description: ${text(hike.shortDescription)}`,
    text(hike.longDescription) && `Description: ${text(hike.longDescription)}`,
    lead && `A web search suggested ${lead}; search for it to check.`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** The request for the next turn: on the last, Gemini must choose. */
export function trailRequest(contents: readonly unknown[], last: boolean) {
  return {
    systemInstruction: { parts: [{ text: TRAIL_SEARCH_PROMPT }] },
    contents,
    tools: TOOLS,
    toolConfig: {
      functionCallingConfig: last
        ? { mode: 'ANY', allowedFunctionNames: ['choose_trail'] }
        : { mode: 'AUTO' },
    },
    generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
  };
}

// /trail/<country>/<region>/<trail>, as every AllTrails trail page is.
// A page in another language (/de/trail/…) is the same trail's.
const TRAIL_PATH =
  /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?(\/trail\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+)\/?$/i;

/**
 * `value` as a link to an AllTrails trail page, or null: rebuilt from its
 * path alone, so it carries no credentials, port, query, language or stray
 * spaces.
 */
export function trailPage(value: unknown): string | null {
  // (URL parsing drops the spaces around a link.) A web link on AllTrails'
  // host; its path is checked here, since a page in another language's
  // doesn't start /trail/ as a saved link's must.
  if (!isSavableUrl(value, null)) return null;
  const url = new URL(value as string);
  const path = TRAIL_PATH.exec(url.pathname)?.[1];
  const onAllTrails = LINK_HOSTS.allTrailsUrl?.test(url.hostname);
  if (!onAllTrails || url.username || url.password || url.port || !path) return null;
  return `https://www.alltrails.com${path}`;
}

/** A trail's numbers, as its page gave them to the search; null where it gave none. */
export interface TrailStats {
  rating: number | null;
  reviews: number | null;
  miles: number | null;
  feet: number | null;
}

export interface TrailResult extends TrailStats {
  url: string;
  title: string;
  snippet: string;
  /** The page's own description, or else its snippet. */
  description: string;
  /** The page's picture, as the search listed it, or null. */
  image: string | null;
}

/** A trail the person may choose: its page, name, description, numbers and picture. */
export interface TrailOption extends TrailStats {
  url: string;
  title: string;
  description: string;
  image: string | null;
}

/** What a search found: the trail picked (or none), and the trails to choose from, it first. */
export interface TrailFind {
  url: string | null;
  options: TrailOption[];
}

// A page's title without AllTrails' suffix ("… | Map, Guide - California |
// AllTrails"), or else the trail's name from its address.
function trailTitle(title: unknown, url: string): string {
  const [name = ''] = text(title).split(/\s*\|\s*/);
  if (name) return name;
  const slug = url.slice(url.lastIndexOf('/') + 1).replace(/--\d+$/, '');
  return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Hosts a trail's picture may come from: AllTrails' own, or the thumbnail
// Google keeps of it.
const IMAGE_HOST = /(^|\.)(alltrails\.com|gstatic\.com)$/i;

/** `value` as an https link to a picture on an allowed host, or null. */
export function trailImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' &&
      IMAGE_HOST.test(url.hostname) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// The first entry of a list in a page's metadata, or nothing.
const firstOf = (list: unknown): Record<string, unknown> | undefined =>
  Array.isArray(list) ? ((list as unknown[])[0] as Record<string, unknown> | undefined) : undefined;

// A snippet's text with the few entities search snippets carry decoded.
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
};
// A snippet as plain text. The search marks the words it matched
// (<b>…</b>): those tags go, again and again until none is left (so no tag
// can be rebuilt from the pieces of others), and then any < or > still
// there, so the text holds no markup at all.
function decoded(snippet: string): string {
  let text = snippet.replace(/&(amp|quot|#39|nbsp|lt|gt);/g, (e) => ENTITIES[e] ?? e);
  for (let before = ''; before !== text;) {
    before = text;
    text = text.replace(/<[^<>]*>/g, '');
  }
  return text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

// A number written in a page ("1,234"), or null.
const numberIn = (value: unknown): number | null => {
  const written = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const n = Number(written.replace(/,/g, ''));
  return written.trim() !== '' && Number.isFinite(n) ? n : null;
};

// The first of these patterns to match `words`, its number.
const first = (words: string, patterns: readonly RegExp[]): unknown =>
  patterns.map((p) => p.exec(words)?.[1]).find((n) => n !== undefined);

// Numbers past these are no trail's: a misread, kept out of the form (and
// of GraphQL's Int, which would fail the whole draft on one).
const MOST_FEET = 30_000;
const MOST_REVIEWS = 10_000_000;

// A number as a page writes one: digits, with commas and a fraction.
const N = String.raw`(\d[\d,]*(?:\.\d+)?)`;

/**
 * A trail's numbers, from the rating its page marks up (schema.org's
 * AggregateRating, which the search lists in its page map) and from its
 * description's words: "Head out on this 8.4-mile out-and-back trail…",
 * "Length 8.4 mi · Elevation gain 1,640 ft". A trail's own length ("8.4-mile
 * trail") is preferred to any other distance its words give ("2 miles from
 * town"). What isn't there, or isn't a sensible number, is null.
 */
export function trailStats(
  pagemap: Record<string, unknown> | undefined,
  words: string,
): TrailStats {
  const rated = firstOf(pagemap?.aggregaterating);
  const rating = numberIn(rated?.ratingvalue);
  const reviews =
    numberIn(rated?.reviewcount) ??
    numberIn(rated?.ratingcount) ??
    numberIn(first(words, [new RegExp(`${N}\\s+(?:reviews|ratings)\\b`, 'i')]));
  const miles = numberIn(
    first(words, [
      new RegExp(`${N}-mile`, 'i'),
      new RegExp(`length:?\\s*${N}\\s*mi\\b`, 'i'),
      new RegExp(`${N}\\s+mi(?:le)?s?\\b`, 'i'),
    ]),
  );
  const feet = numberIn(
    first(words, [
      new RegExp(`elevation gain(?::|\\s+of)?\\s*${N}\\s*(?:ft|feet)\\b`, 'i'),
      new RegExp(`${N}\\s*(?:ft|feet)\\s+(?:of\\s+)?elevation gain`, 'i'),
    ]),
  );
  return {
    rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    reviews:
      reviews !== null && Number.isInteger(reviews) && reviews >= 0 && reviews <= MOST_REVIEWS
        ? reviews
        : null,
    miles: miles !== null && miles > 0 && miles < 1000 ? miles : null,
    feet: feet !== null && feet >= 0 && feet <= MOST_FEET ? Math.round(feet) : null,
  };
}

/** The trail pages in an Agent Search response, each once, in its order. */
export function trailResults(response: unknown): TrailResult[] {
  const results = (response as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const trails = new Map<string, TrailResult>();
  for (const result of results as unknown[]) {
    const page = (result as { document?: { derivedStructData?: unknown } } | null)?.document
      ?.derivedStructData as
      | { link?: unknown; title?: unknown; snippets?: unknown; pagemap?: Record<string, unknown> }
      | undefined;
    const url = trailPage(page?.link);
    if (!url || trails.has(url)) continue;
    // The page's own picture (og:image), else Google's thumbnail of it.
    const meta = firstOf(page?.pagemap?.metatags);
    const thumb = firstOf(page?.pagemap?.cse_thumbnail);
    const snippet = decoded(text(firstOf(page?.snippets)?.snippet));
    const own = decoded(text(meta?.['og:description'] ?? meta?.description));
    trails.set(url, {
      url,
      title: trailTitle(page?.title, url),
      snippet,
      description: own || snippet,
      image: trailImage(meta?.['og:image']) ?? trailImage(thumb?.src),
      ...trailStats(page?.pagemap, `${own} ${snippet}`),
    });
  }
  return [...trails.values()];
}

interface FunctionCall {
  name?: unknown;
  args?: unknown;
  id?: unknown;
}

// The reply's content, kept whole to send back (a Gemini 3 reply carries
// thought signatures it must get back), and the calls it makes.
function replyOf(data: unknown): { content: unknown; calls: FunctionCall[] } {
  const content: unknown = (data as { candidates?: { content?: unknown }[] } | null)
    ?.candidates?.[0]?.content;
  const parts: unknown = (content as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts)) throw Object.assign(new Error('no reply'), { name: 'NoReply' });
  const calls = (parts as unknown[])
    .map((p) => (p as { functionCall?: unknown } | null)?.functionCall)
    .filter((c): c is FunctionCall => typeof c === 'object' && c !== null);
  return { content, calls };
}

const argOf = (call: FunctionCall, key: string): unknown =>
  (call.args as Record<string, unknown> | null | undefined)?.[key];

// A list Gemini gave, or none.
const listed = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

// How many trails had each of the things the form shows, for the log.
const withEach = (trails: readonly TrailResult[]) => {
  const count = (has: (t: TrailResult) => boolean) => trails.filter(has).length;
  return {
    image: count((t) => t.image !== null),
    ownDescription: count((t) => t.description !== t.snippet),
    rating: count((t) => t.rating !== null),
    reviews: count((t) => t.reviews !== null),
    miles: count((t) => t.miles !== null),
    feet: count((t) => t.feet !== null),
  };
};

// The trails to choose from: the pick, then up to MAX_OTHERS more, each a
// page a search returned, once, with its name.
function offered(links: readonly unknown[], found: ReadonlyMap<string, TrailResult>) {
  const [pick, ...rest] = links;
  const options: TrailOption[] = [];
  const add = (link: unknown) => {
    const result = found.get(trailPage(link) ?? '');
    if (result && !options.some((o) => o.url === result.url)) {
      const { url, title, description, image, rating, reviews, miles, feet } = result;
      options.push({ url, title, description, image, rating, reviews, miles, feet });
    }
  };
  add(pick);
  const most = options.length + MAX_OTHERS;
  for (const link of rest) if (options.length < most) add(link);
  return options;
}

/**
 * The AllTrails page of `hike`'s trail (null when the search found none),
 * with the trails to choose from should it be wrong; undefined when the
 * search failed, so it can't say.
 */
export async function findAllTrailsUrl(
  hike: DraftedHike,
  tools: TrailTools,
): Promise<TrailFind | undefined> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const queries: string[] = [];
  const found = new Map<string, TrailResult>();
  // The request under way, for a failure to name.
  let step: 'gemini' | 'search' | undefined;

  // Runs one search Gemini asked for; what it's told back.
  const searchFor = async (call: FunctionCall) => {
    const query = text(argOf(call, 'query'));
    if (call.name !== 'search_alltrails' || !query) return { error: 'Not a search.' };
    if (queries.length >= MAX_SEARCHES) return { error: 'No searches left: choose a trail.' };
    queries.push(query);
    const results = trailResults(await tools.search(query));
    for (const r of results) found.set(r.url, r);
    // Gemini reads names and snippets; pictures are for the person.
    return { results: results.map(({ url, title, snippet }) => ({ url, title, snippet })) };
  };

  try {
    let contents: readonly unknown[] = [{ role: 'user', parts: [{ text: trailQuestion(hike) }] }];
    for (let round = 0; ; round++) {
      step = 'gemini';
      const { content, calls } = replyOf(
        await tools.gemini(trailRequest(contents, round === MAX_ROUNDS)),
      );
      const choice = calls.find((c) => c.name === 'choose_trail');
      if (choice || calls.length === 0 || round === MAX_ROUNDS) {
        const chosen = choice ? trailPage(argOf(choice, 'url')) : null;
        // Kept only if a search returned it, and so are the others offered.
        const kept = chosen && found.has(chosen) ? chosen : null;
        const options = offered([kept, ...listed(choice && argOf(choice, 'others'))], found);
        logEvent('draft.trail_search', {
          ms: ms(),
          queries,
          results: found.size,
          pick: chosen,
          chosen: chosen !== null,
          kept: kept !== null,
          others: options.length - (kept === null ? 0 : 1),
          // How many of the trails found came with each thing the form shows.
          with: withEach([...found.values()]),
        });
        return { url: kept, options };
      }
      step = 'search';
      const parts = await Promise.all(
        calls.map(async (call) => ({
          functionResponse: {
            name: call.name,
            ...(call.id === undefined ? {} : { id: call.id }),
            response: await searchFor(call),
          },
        })),
      );
      contents = [...contents, content, { role: 'user', parts }];
    }
  } catch (err) {
    // The draft still succeeds, with only its own link: an event, not an error.
    logEvent('draft.trail_search_failed', {
      step,
      ...(err instanceof HttpError
        ? { status: err.status, detail: err.detail }
        : { error: err instanceof Error ? err.name : 'Error' }),
      ms: ms(),
    });
    return undefined;
  }
}
