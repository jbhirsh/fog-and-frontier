import { findCoverImage } from '../_coverImage.js';
import { badGateway, badInput } from '../_gqlError.js';
import { logServerError } from '../_log.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';
import { HOME_BASE } from '../_home.js';

// The city alone, for "some San Jose, some Bay Area".
const HOME_CITY = HOME_BASE.split(',')[0];

// Gemini-backed resolvers (owner-gated paid calls): generateActivity +
// alltrailsLookup mutations and the lazy `discover` query. Upstream failures
// throw BAD_GATEWAY (REST 502); we keep the explicit logServerError calls so
// the #20 observability of those 502s survives (BAD_GATEWAY is "user-facing",
// so formatError won't double-log it). A missing API key throws a plain Error
// → INTERNAL, also logged — matching the REST 500.

// Gemini 3 can combine a JSON response schema with the built-in Google Search
// and URL context tools, so each call below looks facts up (and reads the
// links it's given) instead of answering from memory, and still returns
// schema-shaped JSON. Exported so the eval harness reports the model it graded.
export const MODEL = 'gemini-3.8-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const ROUTE = '/api/graphql';

// Google Search for facts, URL context to read the pages a prompt names.
const GROUNDING_TOOLS = [{ googleSearch: {} }, { urlContext: {} }];

// No temperature: from Gemini 3.6 on, Google ignores temperature/topP/topK
// (later models will reject them), so effort is set with a thinking level.
// Structured output alongside tools is a Gemini 3 preview feature.
function jsonConfig(schema: unknown, thinkingLevel: 'low' | 'medium') {
  return {
    responseMimeType: 'application/json',
    responseJsonSchema: schema,
    thinkingConfig: { thinkingLevel },
  };
}

type GeminiPart = { text?: string; thought?: boolean };

// The answer's text. A grounded reply can arrive in more than one part, and a
// thinking model may add thought parts, so join the text of every part that
// isn't a thought.
function responseText(data: {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}): string | undefined {
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  return text || undefined;
}

// --- generateActivity ------------------------------------------------------

// Legal value sets for ACTIVITY_SCHEMA's enum fields. Exported so the eval
// harness (eval/, issue #122) grades against the same source of truth instead
// of a drifting copy; referencing them below serializes identically to the
// previous inline arrays.
export const CATEGORY_VALUES = [
  'hiking', 'cycling', 'water', 'food', 'culture',
  'scenic', 'climbing', 'camping', 'other',
] as const;
export const REGION_VALUES = [
  'sf', 'north-bay', 'east-bay', 'south-bay', 'peninsula',
  'central-coast', 'norcal', 'socal', 'oregon', 'washington',
] as const;
export const PARK_TYPE_VALUES = [
  'national', 'state', 'regional', 'county', 'city', 'private', 'none',
] as const;
export const DURATION_VALUES = [
  '1-2 Hours', '2-3 Hours', 'Half Day', 'Full Day', 'Weekend', 'Multi-Day',
] as const;
export const DIFFICULTY_VALUES = ['easy', 'moderate', 'advanced'] as const;
export const PRICE_RANGE_VALUES = ['$', '$$', '$$$', '$$$$'] as const;

// ACTIVITY_SCHEMA's required-field list, hoisted for the same reason as the
// enum arrays above: the eval harness grades required-field presence and must
// not drift from what the schema actually demands of the model.
export const ACTIVITY_REQUIRED_FIELDS = [
  'name', 'shortDescription', 'longDescription', 'category', 'region',
  'city', 'lat', 'lng', 'duration', 'difficulty', 'dogFriendly',
] as const;

const ACTIVITY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Concise display name (3-7 words)' },
    shortDescription: {
      type: 'string',
      description: 'One-sentence summary, max ~160 chars, evocative tone',
    },
    longDescription: {
      type: 'string',
      description:
        'A 2-4 sentence paragraph with concrete details, history, or what to expect',
    },
    category: {
      type: 'string',
      enum: CATEGORY_VALUES,
    },
    region: {
      type: 'string',
      enum: REGION_VALUES,
    },
    parkType: {
      type: 'string',
      enum: PARK_TYPE_VALUES,
      description:
        'Land/park designation that manages the site (e.g. a state park, county park, GGNRA = national). Omit if the activity is not in a park.',
    },
    city: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    duration: {
      type: 'string',
      enum: DURATION_VALUES,
    },
    durationDetail: {
      type: 'string',
      description: 'Optional travel/time hint, e.g. "~1h drive each way"',
    },
    difficulty: { type: 'string', enum: DIFFICULTY_VALUES },
    dogFriendly: { type: 'boolean' },
    hikeDistanceMiles: { type: 'number' },
    hikeElevationFeet: { type: 'number' },
    allTrailsUrl: {
      type: 'string',
      description: 'Full AllTrails URL if it exists; omit if unsure',
    },
    cuisine: {
      type: 'string',
      description:
        'Restaurants only: cuisine or food style, e.g. "Coastal Californian", "Danish bakery". Omit for non-restaurants.',
    },
    priceRange: {
      type: 'string',
      enum: PRICE_RANGE_VALUES,
      description: 'Restaurants only: rough cost tier. Omit for non-restaurants.',
    },
    hours: {
      type: 'string',
      description:
        'Restaurants only: opening hours summary, e.g. "Thu–Mon 11am–8pm". Omit if unsure or non-restaurant.',
    },
    reservationUrl: {
      type: 'string',
      description:
        'Restaurants only: reservation or booking URL (OpenTable/Resy/official). Omit if unsure.',
    },
    menuUrl: {
      type: 'string',
      description: 'Restaurants only: menu or official website URL. Omit if unsure.',
    },
    dietary: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Restaurants only: dietary options offered, e.g. ["vegetarian","vegan","gluten-free"]. Omit for non-restaurants.',
    },
    notes: {
      type: 'string',
      description:
        'Practical tips: parking, fees, dog rules, best season — keep terse',
    },
  },
  required: ACTIVITY_REQUIRED_FIELDS,
};

// Non-null scalar fields of `GeneratedActivity` (api/_schema.ts) that are sourced
// straight from Gemini's parsed object. lat/lng are numeric; the rest are
// strings. If the model omits one, GraphQL would otherwise serialize an opaque
// non-null error that bubbles to the client — the m3 parity guard in
// generateActivity rejects with a clear BAD_GATEWAY instead.
const REQUIRED_GENERATED_FIELDS = [
  'name',
  'shortDescription',
  'category',
  'region',
  'city',
  'lat',
  'lng',
  'duration',
] as const;

// Optional fields of GeneratedActivity whose value must come from a fixed set:
// difficulty/parkType are GraphQL enums (an unknown value fails serialization
// with an opaque error), and priceRange is a String the client narrows to its
// PriceRange union. A value outside the set is dropped, like an omitted field.
// (category, the one required enum, is checked separately.)
const OPTIONAL_GENERATED_ENUMS: Record<string, readonly string[]> = {
  difficulty: DIFFICULTY_VALUES,
  parkType: PARK_TYPE_VALUES,
  priceRange: PRICE_RANGE_VALUES,
};

// Link fields of GeneratedActivity, with the host each must be on (if any).
// Grounded replies can cite Google's short-lived search redirect
// (vertexaisearch.cloud.google.com) in place of the page itself; a saved link
// has to be the real page, so the guard below drops a redirect, anything that
// isn't an http(s) URL, and an AllTrails link that isn't a trail page on
// alltrails.com.
const GENERATED_URL_HOSTS: Record<string, RegExp | null> = {
  allTrailsUrl: /^(www\.)?alltrails\.com$/,
  reservationUrl: null,
  menuUrl: null,
};

function isSavableUrl(value: unknown, host: RegExp | null): boolean {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.hostname === 'vertexaisearch.cloud.google.com') return false;
  if (host === null) return true;
  return host.test(url.hostname) && url.pathname.startsWith('/trail/');
}

const GENERATE_SYSTEM_PROMPT = `You are a Bay Area outdoor-activity research assistant for a personal travel app called "Fog and Frontier". Given a user's free-form title and optional notes/links, populate a structured Activity record.

Rules:
- The home base is ${HOME_BASE}. Most activities are within a few hours' drive of the SF Bay Area, but coastal Oregon, Washington, and SoCal are also valid.
- Use Google Search to check the facts (location, park, hours, prices, trail stats, links) rather than answering from memory, and read any links in the user's notes. If you cannot verify something (e.g. exact AllTrails URL, hike distance), omit that optional field rather than guess.
- Only give a URL (allTrailsUrl, reservationUrl, menuUrl) that you found in your search results or the user's links; never construct one. Give the page's own address, never a vertexaisearch.cloud.google.com redirect.
- Coordinates: provide best-known lat/lng for the activity (the trailhead, the restaurant, the park entrance).
- "category" must reflect the dominant activity. "scenic" for drives/lookouts; "other" only if nothing else fits.
- "duration" should reflect realistic round-trip time from ${HOME_BASE} including driving.
- "shortDescription" should be vivid and specific, not generic, with the specifics taken from your sources.
- In "shortDescription" and "longDescription", name a place or thing inside the activity (a grove, trail, viewpoint, landmark, dish, room) only if a source you found names it there. Describe anything you can't confirm in general terms instead; a vivid general line beats a specific name that turns out to belong somewhere else.
- "notes" should mention dog rules, parking, fees, or seasonal tips when relevant.
- "parkType" should reflect who manages the land when the activity is in a park: 'national' for national parks/seashores/monuments and GGNRA sites, 'state' for state parks/reserves, 'regional' for regional open-space/park districts (e.g. EBRPD, Midpen), 'county' for county parks, 'city' for municipal parks, 'private' for privately managed grounds. Omit it entirely if the activity isn't in a park (e.g. a restaurant or a library).
- When the activity is a restaurant or food spot (category "food"), also populate the restaurant fields when you can: "cuisine", "priceRange" ($ to $$$$), "hours", "reservationUrl", "menuUrl", and "dietary" options. Omit any you can't determine, and omit all of them for non-food activities.`;

async function generateActivity(
  _parent: unknown,
  { input }: { input: { title?: unknown; notes?: unknown } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (!title) throw badInput('title is required');

  const userPrompt = notes
    ? `Title: ${title}\n\nUser notes/links:\n${notes}`
    : `Title: ${title}`;

  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: GENERATE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: GROUNDING_TOOLS,
      generationConfig: jsonConfig(ACTIVITY_SCHEMA, 'medium'),
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    logServerError(new Error(`gemini request failed: ${r.status}`), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('gemini request failed');
  }

  const text = responseText((await r.json()) as Parameters<typeof responseText>[0]);
  if (!text) {
    logServerError(new Error('no content in gemini response'), {
      route: ROUTE,
      method: 'POST',
      status: 502,
    });
    throw badGateway('no content in gemini response');
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    logServerError(err, {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('gemini returned non-JSON');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    logServerError(new Error('gemini returned a non-object'), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('gemini returned a non-object');
  }
  const parsed = json as Record<string, unknown>;

  // Parity guard (#91 m3): the old REST handler returned Gemini's object verbatim
  // and the client tolerated gaps. Under GraphQL the partly-non-null
  // GeneratedActivity type turns a missing required field into an opaque non-null
  // error that bubbles to the client. Validate the required fields up front and
  // surface a clear BAD_GATEWAY (REST 502, the upstream-failure channel) instead.
  const missing = REQUIRED_GENERATED_FIELDS.filter((field) =>
    field === 'lat' || field === 'lng'
      ? typeof parsed[field] !== 'number'
      : typeof parsed[field] !== 'string',
  );
  if (missing.length > 0) {
    const detail = `gemini response missing required field(s): ${missing.join(', ')}`;
    logServerError(new Error(detail), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway(detail);
  }

  // Same channel for the required category holding a value outside its set.
  if (!(CATEGORY_VALUES as readonly unknown[]).includes(parsed.category)) {
    const detail = 'gemini response has an out-of-range category';
    logServerError(new Error(detail), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway(detail);
  }
  for (const [field, values] of Object.entries(OPTIONAL_GENERATED_ENUMS)) {
    const v = parsed[field];
    if (v !== undefined && v !== null && !values.includes(v as string)) {
      parsed[field] = null;
    }
  }
  for (const [field, host] of Object.entries(GENERATED_URL_HOSTS)) {
    const v = parsed[field];
    if (v !== undefined && v !== null && !isSavableUrl(v, host)) parsed[field] = null;
  }

  // Location-aware Wikimedia Commons lookup (#36). The required-field guard
  // above means name/category/lat/lng are present and typed. No match leaves
  // the cover unset so the UI shows the category placeholder.
  const cover = await findCoverImage({
    name: parsed.name as string,
    category: parsed.category as string,
    lat: parsed.lat as number,
    lng: parsed.lng as number,
  });
  if (cover) {
    parsed.coverImage = cover.url;
    parsed.coverCredit = cover.credit;
  }

  return { activity: parsed };
}

// --- alltrailsLookup -------------------------------------------------------

const ALLTRAILS_SCHEMA = {
  type: 'object',
  properties: {
    allTrailsRating: { type: 'number' },
    hikeDistanceMiles: { type: 'number' },
    hikeElevationFeet: { type: 'number' },
  },
};

const ALLTRAILS_SYSTEM_PROMPT = `You look up hiking-trail data from AllTrails URLs. Given a URL, return the trail's current AllTrails rating (0-5, one decimal), distance in miles, and elevation gain in feet. Read the page at the URL; if it can't be read, use Google Search to find that same AllTrails trail's listing. Be factual — omit any field you cannot verify for this exact trail rather than guess, and return nothing for a trail you can't find. Return numbers only (e.g. 4.6, not "4.6 stars").`;

async function alltrailsLookup(
  _parent: unknown,
  { input }: { input: { url?: unknown } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) throw badInput('url is required');
  if (!/^https?:\/\/(www\.)?alltrails\.com\//i.test(url)) {
    throw badInput('must be an alltrails.com URL');
  }

  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ALLTRAILS_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `URL: ${url}` }] }],
      tools: GROUNDING_TOOLS,
      generationConfig: jsonConfig(ALLTRAILS_SCHEMA, 'low'),
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    logServerError(new Error(`gemini request failed: ${r.status}`), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('lookup failed');
  }

  const text = responseText((await r.json()) as Parameters<typeof responseText>[0]);
  if (!text) {
    logServerError(new Error('no content in gemini response'), {
      route: ROUTE,
      method: 'POST',
      status: 502,
    });
    throw badGateway('no content in lookup response');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    logServerError(err, {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('lookup returned non-JSON');
  }

  const lookup: Record<string, number | null> = {
    allTrailsRating: null,
    hikeDistanceMiles: null,
    hikeElevationFeet: null,
  };
  for (const key of [
    'allTrailsRating',
    'hikeDistanceMiles',
    'hikeElevationFeet',
  ] as const) {
    const v = parsed[key];
    if (typeof v === 'number' && Number.isFinite(v)) lookup[key] = v;
  }

  return { lookup };
}

// --- discover --------------------------------------------------------------

const DISCOVER_SYSTEM_PROMPT = `You are a Bay Area local-events research assistant for a personal travel app. The user lives in ${HOME_BASE}. Use Google Search to find specific, real, time-bound events happening in the requested window — concerts, markets, festivals, art openings, hikes-with-groups, free outdoor stuff, anything interesting.

Output rules:
- Return a JSON array of events.
- "startDate" and "endDate" are ISO calendar dates (YYYY-MM-DD) in Pacific Time. For single-day events, omit "endDate". For multi-day events (festivals, runs that span a weekend), set both.
- "dateText" is a human-readable date/time like "Sat May 10, 2-6 PM" — match what the source says.
- "location" should be the venue + city, e.g. "Plaza Park, Los Gatos".
- "blurb" is one short sentence (~140 chars max), specific and concrete, not generic.
- "sourceUrl" must be a real URL from your search — the page's own address, not a vertexaisearch.cloud.google.com redirect — never invent one. If you're not confident, omit the event.
- 6-12 events total. Prefer geographic diversity (some ${HOME_CITY}, some Bay Area). Mix free and ticketed.
- Skip generic "things to do in SF" listicles — only specific dated events.`;

const DISCOVER_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      dateText: { type: 'string' },
      startDate: { type: 'string', format: 'date', description: 'Pacific Time' },
      endDate: { type: 'string', format: 'date', description: 'Multi-day events only' },
      location: { type: 'string' },
      blurb: { type: 'string' },
      sourceUrl: { type: 'string' },
    },
    required: ['name', 'dateText', 'startDate', 'location', 'blurb', 'sourceUrl'],
  },
};

function rangeToPrompt(range: string): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  switch (range) {
    case 'today':
      return `Today is ${today}. Find events happening today in or within driving distance of ${HOME_BASE}.`;
    case 'tomorrow':
      return `Today is ${today}. Find events happening tomorrow in or within driving distance of ${HOME_BASE}.`;
    case 'week':
      return `Today is ${today}. Find events happening in the next 7 days in or within driving distance of ${HOME_BASE}.`;
    case 'weekend':
    default:
      return `Today is ${today}. Find events happening this weekend (or the next upcoming Saturday and Sunday if today is mid-week) in or within driving distance of ${HOME_BASE}.`;
  }
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// DiscoverEvent fields are all nullable (unvalidated live model output, B2). We
// map each event defensively so a non-array / non-object response can't break
// the non-null `events: [DiscoverEvent!]!` list.
function mapEvents(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e) => ({
      name: str(e.name),
      dateText: str(e.dateText),
      startDate: str(e.startDate),
      endDate: str(e.endDate),
      location: str(e.location),
      blurb: str(e.blurb),
      sourceUrl: str(e.sourceUrl),
    }));
}

async function discover(
  _parent: unknown,
  { range }: { range?: string | null },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const effectiveRange = range ?? 'weekend';
  const userPrompt = rangeToPrompt(effectiveRange);

  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: DISCOVER_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: GROUNDING_TOOLS,
      generationConfig: jsonConfig(DISCOVER_SCHEMA, 'medium'),
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    logServerError(new Error(`gemini request failed: ${r.status}`), {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('gemini request failed');
  }

  const data = (await r.json()) as {
    candidates?: {
      content?: { parts?: GeminiPart[] };
      groundingMetadata?: {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
      };
    }[];
  };
  const text = responseText(data);
  if (!text) {
    logServerError(new Error('no content in gemini response'), {
      route: ROUTE,
      method: 'POST',
      status: 502,
    });
    throw badGateway('no content in gemini response');
  }

  let events: unknown;
  try {
    events = JSON.parse(stripJsonFence(text));
  } catch (err) {
    logServerError(err, {
      route: ROUTE,
      method: 'POST',
      status: 502,
      detail: text.slice(0, 500),
    });
    throw badGateway('gemini returned non-JSON');
  }

  const sources =
    data.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((c) => c.web)
      .filter((w): w is { uri: string; title: string } => Boolean(w?.uri && w?.title))
      .map((w) => ({ uri: w.uri, title: w.title })) ?? [];

  return { range: effectiveRange, events: mapEvents(events), sources };
}

export const geminiQuery = { discover };
export const geminiMutation = { generateActivity, alltrailsLookup };
