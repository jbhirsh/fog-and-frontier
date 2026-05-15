import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from './_auth.js';
import { BudgetExceededError, enforceDailyBudget } from './_gemini_budget.js';

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
- "notes" should mention dog rules, parking, fees, or seasonal tips when relevant.`;

type Body = { title?: unknown; notes?: unknown };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!(await requireOwner(req, res))) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }

  try {
    await enforceDailyBudget('generate');
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      res
        .status(429)
        .json({ error: 'daily budget exceeded', resetsAt: err.resetsAt });
      return;
    }
    throw err;
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
    res.status(502).json({ error: 'gemini request failed', detail: text });
    return;
  }

  const data = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    res.status(502).json({ error: 'no content in gemini response' });
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    res.status(502).json({ error: 'gemini returned non-JSON', raw: text });
    return;
  }

  const name = typeof parsed.name === 'string' ? parsed.name : title;
  const city = typeof parsed.city === 'string' ? parsed.city : '';
  const coverImage = await findWikipediaThumbnail(name, city);
  if (coverImage) parsed.coverImage = coverImage;

  res.status(200).json(parsed);
}

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
