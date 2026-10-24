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

/** A request that was answered with an error status. */
export class HttpError extends Error {
  constructor(readonly status: number) {
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
- If no result is a trail at this place, call choose_trail without a url.`;

// Rounds of searching before Gemini must choose, and searches in all.
export const MAX_ROUNDS = 3;
export const MAX_SEARCHES = 6;

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

export interface TrailResult {
  url: string;
  title: string;
  snippet: string;
}

/** The trail pages in an Agent Search response, each once, in its order. */
export function trailResults(response: unknown): TrailResult[] {
  const results = (response as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const trails = new Map<string, TrailResult>();
  for (const result of results as unknown[]) {
    const page = (result as { document?: { derivedStructData?: unknown } } | null)?.document
      ?.derivedStructData as { link?: unknown; title?: unknown; snippets?: unknown } | undefined;
    const url = trailPage(page?.link);
    if (!url || trails.has(url)) continue;
    const snippets: unknown = page?.snippets;
    const first: unknown = Array.isArray(snippets) ? (snippets as unknown[])[0] : undefined;
    trails.set(url, {
      url,
      title: text(page?.title),
      snippet: text((first as { snippet?: unknown } | null)?.snippet),
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

/**
 * The AllTrails page of `hike`'s trail; null when the search found none,
 * and undefined when it failed, so it can't say.
 */
export async function findAllTrailsUrl(
  hike: DraftedHike,
  tools: TrailTools,
): Promise<string | null | undefined> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const queries: string[] = [];
  const found = new Set<string>();
  // The request under way, for a failure to name.
  let step: 'gemini' | 'search' | undefined;

  // Runs one search Gemini asked for; what it's told back.
  const searchFor = async (call: FunctionCall) => {
    const query = text(argOf(call, 'query'));
    if (call.name !== 'search_alltrails' || !query) return { error: 'Not a search.' };
    if (queries.length >= MAX_SEARCHES) return { error: 'No searches left: choose a trail.' };
    queries.push(query);
    const results = trailResults(await tools.search(query));
    for (const r of results) found.add(r.url);
    return { results };
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
        // Kept only if a search returned it.
        const kept = chosen && found.has(chosen) ? chosen : null;
        logEvent('draft.trail_search', {
          ms: ms(),
          queries,
          results: found.size,
          chosen: chosen !== null,
          kept: kept !== null,
        });
        return kept;
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
        ? { status: err.status }
        : { error: err instanceof Error ? err.name : 'Error' }),
      ms: ms(),
    });
    return undefined;
  }
}
