// LLM-as-judge helpers for the Gemini output-quality eval harness (issue #122).
//
// Each exported judge grades a resolver's output for factual plausibility using
// gemini-2.5-flash at temperature 0 with a responseSchema, so the verdict parses
// mechanically. The API key is read from process.env.GEMINI_API_KEY at call time
// and passed via the x-goog-api-key header (never the URL).
//
// SECURITY: the request carries the API key. It — and any object holding
// it — must NEVER appear in a thrown error, a CheckResult.detail, or a log line.
// All failure text here is built from HTTP status codes and fixed strings only;
// we never interpolate a caught error, the URL, or the key.

import type { CheckResult } from './types.js';

const JUDGE_MODEL = 'gemini-2.5-flash';
const JUDGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`;
const JUDGE_TIMEOUT_MS = 60_000;

const DESCRIPTIONS_CHECK = 'judge:descriptions';
const REAL_PLACE_CHECK = 'judge:real-place';
const EVENTS_CHECK = 'judge:events';

// --- tiny JSON-schema subset used for both the request and mechanical parsing ---

export type JsonSchema =
  | { type: 'string' }
  | { type: 'boolean' }
  | { type: 'number' }
  | { type: 'integer' }
  | { type: 'array'; items: JsonSchema }
  | { type: 'object'; properties: Record<string, JsonSchema>; required?: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A user-defined predicate keeps element types `unknown`; a bare Array.isArray
// widens the input to `any[]` and would defeat the no-unsafe-* lint rules.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// Validate parsed model output against the same schema we asked Gemini to honor.
// The subset (object/array/string/number/integer/boolean) covers every verdict
// shape below; `required` keys must be present and every present property must
// match its declared type.
export function matchesSchema(value: unknown, schema: JsonSchema): boolean {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'array':
      return isUnknownArray(value) && value.every((item) => matchesSchema(item, schema.items));
    case 'object': {
      if (!isRecord(value)) return false;
      for (const key of schema.required ?? []) {
        if (!(key in value)) return false;
      }
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value && value[key] !== undefined && !matchesSchema(value[key], propSchema)) {
          return false;
        }
      }
      return true;
    }
  }
}

// --- verdict shapes ----------------------------------------------------------

interface DescriptionsVerdict {
  pass: boolean;
  issues: string[];
}

interface RealPlaceVerdict {
  isRealPlace: boolean;
  coordsConsistent: boolean;
  issues: string[];
}

interface EventVerdict {
  index: number;
  plausible: boolean;
  issues: string[];
}

interface EventsVerdict {
  verdicts: EventVerdict[];
}

const DESCRIPTIONS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'issues'],
};

const REAL_PLACE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    isRealPlace: { type: 'boolean' },
    coordsConsistent: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['isRealPlace', 'coordsConsistent', 'issues'],
};

const EVENTS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          plausible: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'plausible', 'issues'],
      },
    },
  },
  required: ['verdicts'],
};

// --- transport ---------------------------------------------------------------

type Attempt<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'retry'; reason: string } // transient — worth one retry
  | { kind: 'fatal'; reason: string }; // permanent — do not retry

function isAbortError(err: unknown): boolean {
  return isRecord(err) && err.name === 'AbortError';
}

export function extractText(envelope: unknown): string | null {
  if (!isRecord(envelope)) return null;
  const candidates = envelope.candidates;
  if (!isUnknownArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!isRecord(first)) return null;
  const content = first.content;
  if (!isRecord(content)) return null;
  const parts = content.parts;
  if (!isUnknownArray(parts) || parts.length === 0) return null;
  const part = parts[0];
  if (!isRecord(part)) return null;
  return typeof part.text === 'string' ? part.text : null;
}

async function attemptJudge<T>(
  systemPrompt: string,
  userPrompt: string,
  responseSchema: JsonSchema,
): Promise<Attempt<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { kind: 'fatal', reason: 'GEMINI_API_KEY not configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const response = await fetch(JUDGE_ENDPOINT, {
      method: 'POST',
      // Key travels as a header, not `?key=` — keeps the secret out of the URL
      // so accidental URL logging structurally cannot leak it.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 429/5xx are transient (rate limit / upstream flake) → retry once.
      // Other 4xx (bad request, auth) will not fix themselves → give up now.
      const retryable = response.status === 429 || response.status >= 500;
      return { kind: retryable ? 'retry' : 'fatal', reason: `HTTP ${response.status}` };
    }

    let parsed: unknown;
    try {
      const envelope: unknown = await response.json();
      const text = extractText(envelope);
      if (text === null) return { kind: 'retry', reason: 'malformed judge response' };
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'retry', reason: 'malformed judge response' };
    }

    // A successful HTTP whose body doesn't match the schema counts as one
    // failure toward the retry, then surfaces as an error (never a pass).
    if (!matchesSchema(parsed, responseSchema)) {
      return { kind: 'retry', reason: 'malformed judge response' };
    }
    return { kind: 'ok', value: parsed as T };
  } catch (err) {
    return {
      kind: 'retry',
      reason: isAbortError(err) ? 'request timed out' : 'network error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

type JudgeCall<T> = { ok: true; value: T } | { ok: false; detail: string };

// Fetch a verdict, retrying exactly once on a transient failure. A double
// failure (or an immediate fatal) resolves to a safe, key-free detail string.
async function callJudge<T>(
  systemPrompt: string,
  userPrompt: string,
  responseSchema: JsonSchema,
): Promise<JudgeCall<T>> {
  const first = await attemptJudge<T>(systemPrompt, userPrompt, responseSchema);
  if (first.kind === 'ok') return { ok: true, value: first.value };
  if (first.kind === 'fatal') {
    return { ok: false, detail: `judge call failed: ${first.reason}` };
  }

  const second = await attemptJudge<T>(systemPrompt, userPrompt, responseSchema);
  if (second.kind === 'ok') return { ok: true, value: second.value };
  return { ok: false, detail: `judge call failed twice: ${second.reason}` };
}

// --- input narrowing ---------------------------------------------------------

function unwrapActivity(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value.activity) ? value.activity : null;
}

function unwrapEvents(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null;
  return isUnknownArray(value.events) ? value.events : null;
}

function readString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

// --- judges ------------------------------------------------------------------

// Rubric calibration (owner-approved, 2026-07-10): the original rubric failed
// any specific claim absent from the known facts, which produced false alarms
// on TRUE statements about famous places across consecutive runs (Big Basin's
// reservation system, Duarte's cioppino/1930s restaurant era, Castle Rock's
// world-class bouldering reputation). Plausibility — the thing issue #122 asks
// this judge to grade — means judging truthfulness, with widely-documented
// famous attributes allowed even when the notes omit them. Uncertainty still
// fails, so genuinely fabricated specifics keep getting caught.
const DESCRIPTIONS_SYSTEM_PROMPT = `You are a strict fact-checker for a personal Bay Area travel app. You are given the KNOWN FACTS about a real place (a title, notes, and verified coordinates) and a generated Activity record. Judge ONLY the record's shortDescription and longDescription for factual plausibility.

FAIL (pass=false) if any of these hold:
- The prose states something FALSE or that CONTRADICTS the known facts.
- The geography is inconsistent with the known location (wrong region, city, body of water, mountain range, or direction).
- The described activity type contradicts the record's category (e.g. it describes a hike when the record is a restaurant).
- The prose plainly describes a different place than the one named.
- The prose states obscure specifics you cannot verify from the known facts or from well-documented public knowledge of this place: exact fees or prices, exact opening hours, exact trail mileage or elevation, or precise dates that are not widely documented. If you are UNSURE whether such a specific is true, FAIL it.

PASS (pass=true) otherwise — including widely-documented, famous attributes of well-known places even when the known facts do not mention them: signature dishes, founding eras, renowned reputations (e.g. a celebrated climbing area described as world-class), landmark features. Generic-but-true evocative prose passes. Do NOT grade writing style, tone, or vividness — only factual plausibility.

Return JSON {pass, issues}. "issues" is a short list of concrete problems, empty when pass=true.`;

export async function judgeDescriptions(
  value: unknown,
  context: string,
): Promise<CheckResult> {
  const activity = unwrapActivity(value);
  if (!activity) {
    return {
      name: DESCRIPTIONS_CHECK,
      status: 'error',
      detail: 'no activity in resolver output',
    };
  }

  const userPrompt = `KNOWN FACTS about the place:
${context}

GENERATED RECORD (judge its shortDescription and longDescription against the facts above):
${JSON.stringify(activity, null, 2)}`;

  const res = await callJudge<DescriptionsVerdict>(
    DESCRIPTIONS_SYSTEM_PROMPT,
    userPrompt,
    DESCRIPTIONS_SCHEMA,
  );
  if (!res.ok) {
    return { name: DESCRIPTIONS_CHECK, status: 'error', detail: res.detail };
  }

  const verdict = res.value;
  return {
    name: DESCRIPTIONS_CHECK,
    status: verdict.pass ? 'pass' : 'fail',
    detail: verdict.issues.length > 0 ? verdict.issues.join('; ') : 'plausible',
  };
}

const REAL_PLACE_SYSTEM_PROMPT = `You verify whether a generated Activity record names a REAL, verifiable place, and whether its coordinates point to where that place actually is.

Given the record (name, city, region, lat, lng, and descriptions), decide:
- isRealPlace: the named place genuinely exists and is verifiable — a real park, trail, restaurant, beach, or landmark — not a fabricated, hallucinated, or generic-invented name.
- coordsConsistent: the given lat/lng plausibly fall at that real place (right city/region, within a reasonable distance of the actual location). If the place is not real, coordsConsistent must be false.

Return JSON {isRealPlace, coordsConsistent, issues}. "issues" is a short list of concrete problems, empty when both are true.`;

export async function judgeRealPlace(value: unknown): Promise<CheckResult> {
  const activity = unwrapActivity(value);
  if (!activity) {
    return {
      name: REAL_PLACE_CHECK,
      status: 'error',
      detail: 'no activity in resolver output',
    };
  }

  const userPrompt = `GENERATED RECORD:
${JSON.stringify(activity, null, 2)}`;

  const res = await callJudge<RealPlaceVerdict>(
    REAL_PLACE_SYSTEM_PROMPT,
    userPrompt,
    REAL_PLACE_SCHEMA,
  );
  if (!res.ok) {
    return { name: REAL_PLACE_CHECK, status: 'error', detail: res.detail };
  }

  const verdict = res.value;
  const pass = verdict.isRealPlace && verdict.coordsConsistent;

  let detail: string;
  if (verdict.issues.length > 0) {
    detail = verdict.issues.join('; ');
  } else if (pass) {
    detail = 'real place, coordinates consistent';
  } else {
    const failed: string[] = [];
    if (!verdict.isRealPlace) failed.push('not a verifiable real place');
    if (!verdict.coordsConsistent) failed.push('coordinates inconsistent with the named place');
    detail = failed.join('; ');
  }

  return { name: REAL_PLACE_CHECK, status: pass ? 'pass' : 'fail', detail };
}

const EVENTS_SYSTEM_PROMPT = `You judge whether local-events listings are specific, real, attendable events versus generic filler or fabrications. The events are for the Los Gatos / San Francisco Bay Area.

For each event decide "plausible":
- plausible=true: a specific, dated, real-sounding event at a real, nameable venue — a concert, farmers market, festival, gallery opening, group hike, race, etc. — with a concrete blurb that fits the name and location.
- plausible=false: generic listicle or evergreen entries ("Explore Golden Gate Park", "Visit the waterfront"), obviously fabricated or non-existent venues, or a blurb that contradicts the event's name or location.

You are judging specificity and plausibility, NOT verifying that the exact date is correct. The user message states today's date — interpret each event's dates relative to it; never assume the current year from your training data.

Return JSON {verdicts:[{index, plausible, issues}]} with exactly one entry per event index provided. "issues" lists concrete problems, empty when plausible.`;

export function describeEvent(event: unknown, index: number): string {
  const rec = isRecord(event) ? event : {};
  const name = readString(rec, 'name') || '(no name)';
  // The ISO startDate carries the year; dateText usually doesn't ("Sat Jul 11").
  // Lead with the ISO date so the judge can never mis-infer the year, and keep
  // dateText as the human-readable supplement.
  const startDate = readString(rec, 'startDate');
  const endDate = readString(rec, 'endDate');
  const isoDate = startDate
    ? `${startDate}${endDate ? `..${endDate}` : ''}`
    : '(no startDate)';
  const dateText = readString(rec, 'dateText');
  const location = readString(rec, 'location') || '(no location)';
  const blurb = readString(rec, 'blurb') || '(no blurb)';
  const sourceUrl = readString(rec, 'sourceUrl') || '(none)';
  return [
    `[${index}] ${name}`,
    `    date: ${isoDate}${dateText ? ` (${dateText})` : ''}`,
    `    location: ${location}`,
    `    blurb: ${blurb}`,
    `    source: ${sourceUrl}`,
  ].join('\n');
}

export async function judgeDiscoverEvents(
  value: unknown,
  minPlausibleFraction: number,
): Promise<CheckResult> {
  const events = unwrapEvents(value);
  if (!events) {
    return {
      name: EVENTS_CHECK,
      status: 'error',
      detail: 'no events array in resolver output',
    };
  }
  // Emptiness is graded by the structural minEvents check, not here.
  if (events.length === 0) {
    return { name: EVENTS_CHECK, status: 'pass', detail: 'no events to judge' };
  }

  // Same "Today is <date>" grounding rangeToPrompt gives the discover resolver
  // (api/_resolvers/gemini.ts): without it the judge assumes its training-data
  // year and grades events named "2026" as contradicting their own dates
  // (proven false failures in the 2026-07-10 CI run — disc-week went 7/11).
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const userPrompt = `Today is ${today}. Judge these ${events.length} events. Return exactly one verdict per index (0..${
    events.length - 1
  }).

${events.map((event, i) => describeEvent(event, i)).join('\n\n')}`;

  const res = await callJudge<EventsVerdict>(EVENTS_SYSTEM_PROMPT, userPrompt, EVENTS_SCHEMA);
  if (!res.ok) {
    return { name: EVENTS_CHECK, status: 'error', detail: res.detail };
  }

  const byIndex = new Map<number, EventVerdict>();
  for (const v of res.value.verdicts) {
    byIndex.set(v.index, v);
  }

  let plausibleCount = 0;
  const problems: string[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const v = byIndex.get(i);
    if (v?.plausible) {
      plausibleCount += 1;
    } else {
      const issues = v ? v.issues : ['no verdict returned'];
      problems.push(`[${i}] ${issues.length > 0 ? issues.join(', ') : 'implausible'}`);
    }
  }

  const fraction = plausibleCount / events.length;
  const pass = fraction >= minPlausibleFraction;
  const summary = `${plausibleCount}/${events.length} plausible (${fraction.toFixed(2)}, need ${minPlausibleFraction.toFixed(2)})`;

  return {
    name: EVENTS_CHECK,
    status: pass ? 'pass' : 'fail',
    detail: pass ? summary : `${summary}; ${problems.join('; ')}`,
  };
}
