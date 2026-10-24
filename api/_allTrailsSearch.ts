// One more look for a hike's AllTrails listing (#6). A draft finds the
// listing of a well-known hike in the same search that checks its other
// facts, but not one AllTrails knows by another name: the first real share,
// Dragon Mountain Peak (Thiên Long Sơn) in Milpitas, is listed as "Dragon
// Mountain Stairs". So a hike drafted without its link gets a second,
// narrower search that looks only for that page, given the draft's own
// facts (names, town, pin, the routes its descriptions mention).
//
// The caller sends the request (`ask`), so this file holds only what to ask
// and what to keep: a trail page on alltrails.com, or nothing. Never throws.
// Nothing here can tell a real page from a well-formed made-up one
// (AllTrails' pages don't answer a fetch): the prompt forbids constructing
// a link, and the shape check keeps out the rest.

import { isSavableUrl, LINK_HOSTS } from './_links.js';

export interface DraftedHike {
  name: string;
  city?: unknown;
  lat: number;
  lng: number;
  shortDescription?: unknown;
  longDescription?: unknown;
}

export interface TrailQuestion {
  system: string;
  user: string;
  schema: unknown;
}

/** Sends one grounded request to Gemini; its answer's text, or nothing. */
export type AskGemini = (question: TrailQuestion) => Promise<string | undefined>;

export const TRAIL_SEARCH_PROMPT = `You find a hike's listing on AllTrails. Given a place that was drafted as a hike, use Google Search to find the AllTrails trail page (alltrails.com/trail/…) for the route most people hike there.

- AllTrails lists trails, not places, often under a different name: search it by every name the place goes by (its common English name and any local or translated one), by the routes and features its description mentions (for example "… Stairs", "… Trail", "… Loop"), and by the nearest town.
- A trail whose trailhead is near the given coordinates is a good sign; one elsewhere, even with a similar name, is a different trail.
- Give the page's own address as your search results show it. Never construct a URL, and never give a vertexaisearch.cloud.google.com redirect.
- Leave "allTrailsUrl" out if no listing you found is a trail at this place.`;

const SCHEMA = {
  type: 'object',
  properties: {
    allTrailsUrl: {
      type: 'string',
      description: 'The alltrails.com/trail/ page of the route; omit if none was found',
    },
  },
};

// A fact as given, trimmed; '' (left out) for anything but a string.
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The question for `hike`: its facts, one to a line. */
export function trailQuestion(hike: DraftedHike): TrailQuestion {
  const lines = [
    `Place: ${hike.name}`,
    text(hike.city) && `Town: ${text(hike.city)}`,
    `Coordinates: ${hike.lat}, ${hike.lng}`,
    text(hike.shortDescription) && `Short description: ${text(hike.shortDescription)}`,
    text(hike.longDescription) && `Description: ${text(hike.longDescription)}`,
  ];
  return { system: TRAIL_SEARCH_PROMPT, user: lines.filter(Boolean).join('\n'), schema: SCHEMA };
}

// /trail/<country>/<region>/<trail>, as every AllTrails trail page is.
const TRAIL_PATH = /^\/trail\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i;

/**
 * `value` as a link to an AllTrails trail page, or null: rebuilt from its
 * path alone, so it carries no credentials, port, query or stray spaces.
 */
export function trailPage(value: unknown): string | null {
  // (URL parsing drops the spaces around a link.)
  if (!isSavableUrl(value, LINK_HOSTS.allTrailsUrl)) return null;
  const url = new URL(value as string);
  if (url.username || url.password || url.port || !TRAIL_PATH.test(url.pathname)) return null;
  return `https://www.alltrails.com${url.pathname.replace(/\/$/, '')}`;
}

/** The AllTrails page of `hike`'s trail, or null when none is found. */
export async function findAllTrailsUrl(hike: DraftedHike, ask: AskGemini): Promise<string | null> {
  try {
    // No answer, or one that isn't an object, throws here too.
    const answer = JSON.parse((await ask(trailQuestion(hike))) as string) as { allTrailsUrl?: unknown };
    return trailPage(answer.allTrailsUrl);
  } catch {
    return null;
  }
}
