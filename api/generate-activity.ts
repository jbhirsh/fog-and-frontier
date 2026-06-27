import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from './_auth.js';
import { logServerError, withErrorLogging } from './_log.js';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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
        'hiking',
        'cycling',
        'water',
        'food',
        'culture',
        'scenic',
        'climbing',
        'camping',
        'other',
      ],
    },
    region: {
      type: 'string',
      enum: [
        'sf',
        'north-bay',
        'east-bay',
        'south-bay',
        'peninsula',
        'central-coast',
        'norcal',
        'socal',
        'oregon',
        'washington',
      ],
    },
    parkType: {
      type: 'string',
      enum: [
        'national',
        'state',
        'regional',
        'county',
        'city',
        'private',
        'none',
      ],
      description:
        'Land/park designation that manages the site (e.g. a state park, county park, GGNRA = national). Omit if the activity is not in a park.',
    },
    city: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    duration: {
      type: 'string',
      enum: [
        '1-2 Hours',
        '2-3 Hours',
        'Half Day',
        'Full Day',
        'Weekend',
        'Multi-Day',
      ],
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
    'name',
    'shortDescription',
    'longDescription',
    'category',
    'region',
    'city',
    'lat',
    'lng',
    'duration',
    'difficulty',
    'dogFriendly',
  ],
};

const SYSTEM_PROMPT = `You are a Bay Area outdoor-activity research assistant for a personal travel app called "Fog and Frontier". Given a user's free-form title and optional notes/links, populate a structured Activity record.

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

type Body = { title?: unknown; notes?: unknown };

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!(await requireOwner(req, res))) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logServerError(new Error('GEMINI_API_KEY not configured'), {
      route: '/api/generate-activity',
      method: req.method,
      status: 500,
    });
    res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  const userPrompt = notes
    ? `Title: ${title}\n\nUser notes/links:\n${notes}`
    : `Title: ${title}`;

  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
      route: '/api/generate-activity',
      method: req.method,
      status: 502,
      detail: text.slice(0, 500),
    });
    res.status(502).json({ error: 'gemini request failed', detail: text });
    return;
  }

  const data = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logServerError(new Error('no content in gemini response'), {
      route: '/api/generate-activity',
      method: req.method,
      status: 502,
    });
    res.status(502).json({ error: 'no content in gemini response' });
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    logServerError(err, {
      route: '/api/generate-activity',
      method: req.method,
      status: 502,
      detail: text.slice(0, 500),
    });
    res.status(502).json({ error: 'gemini returned non-JSON', raw: text });
    return;
  }

  const name = typeof parsed.name === 'string' ? parsed.name : title;
  const city = typeof parsed.city === 'string' ? parsed.city : '';
  const coverImage = await findWikipediaThumbnail(name, city);
  if (coverImage) parsed.coverImage = coverImage;

  res.status(200).json(parsed);
});

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
        query?: {
          pages?: Record<string, { thumbnail?: { source?: string } }>;
        };
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
