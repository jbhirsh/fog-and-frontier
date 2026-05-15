import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from './_auth.js';
import { BudgetExceededError, enforceDailyBudget } from './_gemini_budget.js';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are a Bay Area local-events research assistant for a personal travel app. The user lives in Los Gatos, CA. Use Google Search to find specific, real, time-bound events happening in the requested window — concerts, markets, festivals, art openings, hikes-with-groups, free outdoor stuff, anything interesting.

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

type Body = { range?: unknown };

function rangeToPrompt(range: string | null): string {
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
    await enforceDailyBudget('discover');
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
  const range = typeof body.range === 'string' ? body.range : 'weekend';
  const userPrompt = rangeToPrompt(range);

  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.5 },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    res.status(502).json({ error: 'gemini request failed', detail: text });
    return;
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
    res.status(502).json({ error: 'no content in gemini response' });
    return;
  }

  let events: unknown;
  try {
    events = JSON.parse(stripJsonFence(text));
  } catch {
    res.status(502).json({
      error: 'gemini returned non-JSON',
      raw: text.slice(0, 500),
    });
    return;
  }

  const sources =
    data.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((c) => c.web)
      .filter((w): w is { uri: string; title: string } =>
        Boolean(w?.uri && w?.title),
      ) ?? [];

  res.status(200).json({ events, sources, range });
}
