import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from './_auth.js';
import { logServerError, withErrorLogging } from './_log.js';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SCHEMA = {
  type: 'object',
  properties: {
    allTrailsRating: { type: 'number' },
    hikeDistanceMiles: { type: 'number' },
    hikeElevationFeet: { type: 'number' },
  },
};

const SYSTEM_PROMPT = `You look up hiking-trail data from AllTrails URLs. Given a URL, return the trail's current AllTrails rating (0-5, one decimal), distance in miles, and elevation gain in feet. Be factual — omit any field you cannot verify rather than guess. Return numbers only (e.g. 4.6, not "4.6 stars").`;

type Body = { url?: unknown };

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
      route: '/api/alltrails-lookup',
      method: req.method,
      status: 500,
    });
    res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  if (!/^https?:\/\/(www\.)?alltrails\.com\//i.test(url)) {
    res.status(400).json({ error: 'must be an alltrails.com URL' });
    return;
  }

  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `URL: ${url}` }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    logServerError(new Error(`gemini request failed: ${r.status}`), {
      route: '/api/alltrails-lookup',
      method: req.method,
      status: 502,
      detail: text.slice(0, 500),
    });
    res.status(502).json({ error: 'lookup failed' });
    return;
  }

  const data = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logServerError(new Error('no content in gemini response'), {
      route: '/api/alltrails-lookup',
      method: req.method,
      status: 502,
    });
    res.status(502).json({ error: 'no content in lookup response' });
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    logServerError(err, {
      route: '/api/alltrails-lookup',
      method: req.method,
      status: 502,
      detail: text.slice(0, 500),
    });
    res.status(502).json({ error: 'lookup returned non-JSON' });
    return;
  }

  // Filter to the expected keys only; Gemini occasionally adds extras.
  const out: Record<string, number> = {};
  for (const key of [
    'allTrailsRating',
    'hikeDistanceMiles',
    'hikeElevationFeet',
  ] as const) {
    const v = parsed[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }

  res.status(200).json(out);
});
