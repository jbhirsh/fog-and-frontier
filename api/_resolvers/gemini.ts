import { badGateway, badInput } from '../_gqlError.js';
import { logServerError } from '../_log.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';

// Gemini-backed resolvers (owner-gated paid calls): generateActivity +
// alltrailsLookup mutations and the lazy `discover` query. Upstream failures
// throw BAD_GATEWAY (REST 502); we keep the explicit logServerError calls so
// the #20 observability of those 502s survives (BAD_GATEWAY is "user-facing",
// so formatError won't double-log it). A missing API key throws a plain Error
// → INTERNAL, also logged — matching the REST 500.

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const ROUTE = '/api/graphql';

// --- generateActivity ------------------------------------------------------

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
      enum: [
        'hiking', 'cycling', 'water', 'food', 'culture',
        'scenic', 'climbing', 'camping', 'other',
      ],
    },
    region: {
      type: 'string',
      enum: [
        'sf', 'north-bay', 'east-bay', 'south-bay', 'peninsula',
        'central-coast', 'norcal', 'socal', 'oregon', 'washington',
      ],
    },
    parkType: {
      type: 'string',
      enum: ['national', 'state', 'regional', 'county', 'city', 'private', 'none'],
      description:
        'Land/park designation that manages the site (e.g. a state park, county park, GGNRA = national). Omit if the activity is not in a park.',
    },
    city: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    duration: {
      type: 'string',
      enum: ['1-2 Hours', '2-3 Hours', 'Half Day', 'Full Day', 'Weekend', 'Multi-Day'],
    },
    durationDetail: {
      type: 'string',
      description: 'Optional travel/time hint, e.g. "~1h drive each way"',
    },
    difficulty: { type: 'string', enum: ['easy', 'moderate', 'advanced'] },
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
      enum: ['$', '$$', '$$$', '$$$$'],
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
  required: [
    'name', 'shortDescription', 'longDescription', 'category', 'region',
    'city', 'lat', 'lng', 'duration', 'difficulty', 'dogFriendly',
  ],
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

const GENERATE_SYSTEM_PROMPT = `You are a Bay Area outdoor-activity research assistant for a personal travel app called "Fog and Frontier". Given a user's free-form title and optional notes/links, populate a structured Activity record.

Rules:
- The home base is Los Gatos, CA. Most activities are within a few hours' drive of the SF Bay Area, but coastal Oregon, Washington, and SoCal are also valid.
- Be factual. Prefer well-known landmarks/trails. If you cannot verify something (e.g. exact AllTrails URL, hike distance), omit that optional field rather than guess.
- Coordinates: provide best-known lat/lng for the activity (the trailhead, the restaurant, the park entrance).
- "category" must reflect the dominant activity. "scenic" for drives/lookouts; "other" only if nothing else fits.
- "duration" should reflect realistic round-trip time from Los Gatos including driving.
- "shortDescription" should be vivid and specific, not generic.
- "notes" should mention dog rules, parking, fees, or seasonal tips when relevant.
- "parkType" should reflect who manages the land when the activity is in a park: 'national' for national parks/seashores/monuments and GGNRA sites, 'state' for state parks/reserves, 'regional' for regional open-space/park districts (e.g. EBRPD, Midpen), 'county' for county parks, 'city' for municipal parks, 'private' for privately managed grounds. Omit it entirely if the activity isn't in a park (e.g. a restaurant or a library).
- When the activity is a restaurant or food spot (category "food"), also populate the restaurant fields when you can: "cuisine", "priceRange" ($ to $$$$), "hours", "reservationUrl", "menuUrl", and "dietary" options. Omit any you can't determine, and omit all of them for non-food activities.`;

async function findWikipediaThumbnail(
  name: string,
  city: string,
): Promise<string | null> {
  const queries = [name, city ? `${name} ${city}` : null].filter(
    (q): q is string => Boolean(q),
  );
  for (const q of queries) {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=1200&generator=search&gsrsearch=${encodeURIComponent(
        q,
      )}&gsrlimit=1&origin=*`;
      const r = await fetch(url, {
        headers: { 'user-agent': 'fog-and-frontier/1.0' },
      });
      if (!r.ok) continue;
      const data = (await r.json()) as {
        query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
      };
      const pages = data.query?.pages;
      if (!pages) continue;
      for (const id of Object.keys(pages)) {
        const src = pages[id]?.thumbnail?.source;
        if (src) return src;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

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
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: ACTIVITY_SCHEMA,
      },
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
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logServerError(new Error('no content in gemini response'), {
      route: ROUTE,
      method: 'POST',
      status: 502,
    });
    throw badGateway('no content in gemini response');
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
    throw badGateway('gemini returned non-JSON');
  }

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

  const name = typeof parsed.name === 'string' ? parsed.name : title;
  const city = typeof parsed.city === 'string' ? parsed.city : '';
  const coverImage = await findWikipediaThumbnail(name, city);
  if (coverImage) parsed.coverImage = coverImage;

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

const ALLTRAILS_SYSTEM_PROMPT = `You look up hiking-trail data from AllTrails URLs. Given a URL, return the trail's current AllTrails rating (0-5, one decimal), distance in miles, and elevation gain in feet. Be factual — omit any field you cannot verify rather than guess. Return numbers only (e.g. 4.6, not "4.6 stars").`;

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
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: ALLTRAILS_SCHEMA,
      },
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

  const data = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
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

const DISCOVER_SYSTEM_PROMPT = `You are a Bay Area local-events research assistant for a personal travel app. The user lives in Los Gatos, CA. Use Google Search to find specific, real, time-bound events happening in the requested window — concerts, markets, festivals, art openings, hikes-with-groups, free outdoor stuff, anything interesting.

Output rules:
- Return ONLY a single JSON array of event objects. No prose, no markdown fences.
- Each event must have: { "name": string, "dateText": string, "startDate": string, "endDate"?: string, "location": string, "blurb": string, "sourceUrl": string }
- "startDate" and "endDate" are ISO calendar dates (YYYY-MM-DD) in Pacific Time. For single-day events, omit "endDate". For multi-day events (festivals, runs that span a weekend), set both.
- "dateText" is a human-readable date/time like "Sat May 10, 2-6 PM" — match what the source says.
- "location" should be the venue + city, e.g. "Plaza Park, Los Gatos".
- "blurb" is one short sentence (~140 chars max), specific and concrete, not generic.
- "sourceUrl" must be a real URL from your search — never invent one. If you're not confident, omit the event.
- 6-12 events total. Prefer geographic diversity (some Los Gatos, some Bay Area). Mix free and ticketed.
- Skip generic "things to do in SF" listicles — only specific dated events.`;

function rangeToPrompt(range: string): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  switch (range) {
    case 'today':
      return `Today is ${today}. Find events happening today in or within driving distance of Los Gatos, CA.`;
    case 'tomorrow':
      return `Today is ${today}. Find events happening tomorrow in or within driving distance of Los Gatos, CA.`;
    case 'week':
      return `Today is ${today}. Find events happening in the next 7 days in or within driving distance of Los Gatos, CA.`;
    case 'weekend':
    default:
      return `Today is ${today}. Find events happening this weekend (or the next upcoming Saturday and Sunday if today is mid-week) in or within driving distance of Los Gatos, CA.`;
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
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.5 },
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
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
      };
    }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
