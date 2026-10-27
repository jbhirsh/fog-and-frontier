// Card copy for the places saved before it existed (#295): a card line of at
// most 50 characters for every place, and a card name of at most 40 for a
// name too long for a card. An owner runs it from their own machine, in two
// steps, so nothing reaches the catalog unread:
//
//   npm run cards -- draft [review.json] [--all]
//     reads the catalog from production's public API, asks Gemini for each
//     place's copy in a few batched calls (GEMINI_API_KEY, from .env.local
//     as `vercel env pull .env.local` writes it), and writes the review file
//     (card-copy.review.json by default). Only places without a card line are
//     drafted, unless --all. Copy that still doesn't fit after a second ask
//     is written as null, for the owner to fill in.
//
//   npm run cards -- save [review.json]
//     reads the file the owner checked and edited, and if every place has a
//     line that fits, writes them all in one batch to production's Turso, as
//     `vercel env pull .env.prod --environment=production` gives it, once
//     the owner confirms the host (`npm run db:snapshot` first keeps a copy).
//     If any doesn't fit, it says which and writes nothing. A place whose
//     copy changed in the catalog since the draft is left as it is.
//
// The drafts are a paid Gemini call: one per 40 places, plus one for any
// that didn't fit, with no search, so well under a cent for the catalog.

import { createClient } from '@libsql/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CARD_LINE_MAX, CARD_NAME_MAX } from '../shared/cardCopy.ts';
import { runAsScript } from './run-as-script.ts';

/** The model the drafts use (api/_resolvers/gemini.ts's MODEL; a test holds them equal). */
export const MODEL = 'gemini-3.8-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const CATALOG = 'https://fog-and-frontier.vercel.app/api/graphql';
const DEFAULT_FILE = 'card-copy.review.json';

/** Places asked about in one call. */
export const BATCH_SIZE = 40;

/** A place as the catalog gives it to the drafts. */
export interface Place {
  id: string;
  name: string;
  shortDescription: string;
  category: string;
  city: string;
  cardLine: string | null;
  cardName: string | null;
}

/** A place's copy as the review file holds it, for the owner to read and edit. */
export interface Entry {
  id: string;
  name: string;
  shortDescription: string;
  cardLine: string | null;
  cardName: string | null;
  /** The copy the catalog held when drafted; a place whose copy has changed since isn't saved. */
  stored?: { cardLine: string | null; cardName: string | null };
}

/** How long copy is, as a person counts it: in characters, so an é or an emoji is one. */
export function copyLength(text: string): number {
  return [...text].length;
}

/** Whether a name is too long for a card, so wants a card name. */
export function needsCardName(name: string): boolean {
  return copyLength(name.trim()) > CARD_NAME_MAX;
}

/** The places to draft: those without a card line, or every one with `all`. */
export function placesToDraft(places: readonly Place[], all: boolean): Place[] {
  return places.filter((p) => all || !p.cardLine?.trim());
}

/** `list` in runs of at most `size`. */
export function batches<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const SYSTEM = `You write the copy for a travel app's place cards on a phone, where it is shown whole and never cut off, so it must fit.
For each place, from its name and description only (add no facts that aren't there):
- "cardLine": what the place is, in one phrase of at most ${CARD_LINE_MAX} characters, spaces and punctuation included. Concrete and vivid, not generic ("Easy creek loop past a historic mineral spring.", "Fire pits and sunset views over the Pacific."). Don't repeat the name.
- "cardName": only for a place whose name is over ${CARD_NAME_MAX} characters: the shorter name people know it by, at most ${CARD_NAME_MAX} ("Castle Rock State Park" for "Castle Rock State Park (Saratoga Gap & Ridge Loop)"). Omit it for any other place.
Count the characters of each before answering. Answer for every place, by its id.`;

/** The JSON Gemini is held to: one entry per place, by id. */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          cardLine: { type: 'string' },
          cardName: { type: 'string' },
        },
        required: ['id', 'cardLine'],
      },
    },
  },
  required: ['places'],
};

/** What one call asks about: each place, and for a retry what didn't fit last time. */
export function prompt(
  places: readonly Place[],
  tooLong: ReadonlyMap<string, string> = new Map(),
): string {
  return JSON.stringify(
    places.map((p) => ({
      id: p.id,
      name: p.name,
      nameLength: copyLength(p.name),
      description: p.shortDescription,
      category: p.category,
      city: p.city,
      ...(tooLong.has(p.id)
        ? { lastTry: tooLong.get(p.id), lastTryLength: copyLength(tooLong.get(p.id) ?? '') }
        : {}),
    })),
  );
}

/** A Gemini answer's copy, by place id; anything unreadable is left out. */
export function parseReply(reply: unknown): Map<string, { cardLine: unknown; cardName: unknown }> {
  const out = new Map<string, { cardLine: unknown; cardName: unknown }>();
  const text = (reply as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  const places = (parsed as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return out;
  for (const p of places as unknown[]) {
    const id = (p as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') continue;
    const { cardLine, cardName } = p as { cardLine?: unknown; cardName?: unknown };
    out.set(id, { cardLine, cardName });
  }
  return out;
}

function fitting(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && copyLength(text) <= max ? text : null;
}

/**
 * A place's drafted copy, held to the caps: a line that doesn't fit is null,
 * and a card name is kept only for a name too long for a card.
 */
export function fit(
  place: Place,
  drafted: { cardLine: unknown; cardName: unknown } | undefined,
): Entry {
  return {
    id: place.id,
    name: place.name,
    shortDescription: place.shortDescription,
    cardLine: fitting(drafted?.cardLine, CARD_LINE_MAX),
    cardName: needsCardName(place.name) ? fitting(drafted?.cardName, CARD_NAME_MAX) : null,
    stored: { cardLine: place.cardLine, cardName: place.cardName },
  };
}

/** What's wrong with a reviewed file, place by place; empty when it can be saved. */
export function checkReview(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ['the file must hold a list of places'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, e] of (entries as unknown[]).entries()) {
    const { id, name, cardLine, cardName } = (e ?? {}) as Record<string, unknown>;
    const label = typeof name === 'string' && name ? name : `place ${i + 1}`;
    if (typeof id !== 'string' || !id) {
      problems.push(`${label}: no id`);
      continue;
    }
    if (seen.has(id)) problems.push(`${label}: listed twice`);
    seen.add(id);
    const line = typeof cardLine === 'string' ? cardLine.trim() : '';
    if (!line) problems.push(`${label}: no card line`);
    else if (copyLength(line) > CARD_LINE_MAX) {
      problems.push(`${label}: card line is ${copyLength(line)} characters, over ${CARD_LINE_MAX}`);
    }
    if (cardName !== null && cardName !== undefined) {
      if (typeof cardName !== 'string') problems.push(`${label}: card name isn't text`);
      else if (copyLength(cardName.trim()) > CARD_NAME_MAX) {
        problems.push(
          `${label}: card name is ${copyLength(cardName.trim())} characters, over ${CARD_NAME_MAX}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The statements that save a checked file: each place's copy set in its
 * stored JSON, only while it still holds the copy the draft started from (an
 * owner may have written some in the form since), and with its last-edited
 * time left alone, since nothing a person edited changed.
 */
export function saveStatements(entries: readonly Entry[]) {
  return entries.map((e) => ({
    sql:
      "UPDATE a SET j = json_set(j, '$.cardLine', ?, '$.cardName', ?) WHERE id = ?" +
      " AND json_extract(j, '$.cardLine') IS ? AND json_extract(j, '$.cardName') IS ?",
    args: [
      e.cardLine?.trim() ?? null,
      e.cardName?.trim() || null,
      e.id,
      e.stored?.cardLine ?? null,
      e.stored?.cardName ?? null,
    ],
  }));
}

// --- the two steps -----------------------------------------------------------

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env.local');
  if (existsSync(path)) process.loadEnvFile(path);
}

async function readCatalog(): Promise<Place[]> {
  const r = await fetch(CATALOG, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query:
        '{ activities { id name shortDescription category location { city } cardLine cardName } }',
    }),
  });
  const json = (await r.json()) as {
    data?: { activities?: (Omit<Place, 'city'> & { location: { city: string } })[] };
    errors?: { message: string }[];
  };
  if (!json.data?.activities) {
    throw new Error(
      `cards: the catalog couldn't be read (${json.errors?.[0]?.message ?? r.status}); is #295 deployed?`,
    );
  }
  return json.data.activities.map(({ location, ...p }) => ({ ...p, city: location.city }));
}

async function ask(apiKey: string, places: readonly Place[], tooLong?: Map<string, string>) {
  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt(places, tooLong) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: REPLY_SCHEMA,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
  });
  if (!r.ok)
    throw new Error(`cards: Gemini answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return parseReply(await r.json());
}

async function draft(file: string, all: boolean): Promise<void> {
  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('cards: GEMINI_API_KEY not set; run `vercel env pull .env.local`');
  const todo = placesToDraft(await readCatalog(), all);
  console.log(
    `cards: drafting ${todo.length} places in ${Math.ceil(todo.length / BATCH_SIZE)} calls`,
  );
  const entries = new Map<string, Entry>();
  // A line that came back too long, to show Gemini when it's asked again.
  const tooLong = new Map<string, string>();
  for (const batch of batches(todo, BATCH_SIZE)) {
    const drafted = await ask(apiKey, batch);
    for (const p of batch) {
      const entry = fit(p, drafted.get(p.id));
      const line = drafted.get(p.id)?.cardLine;
      if (!entry.cardLine && typeof line === 'string' && line.trim()) tooLong.set(p.id, line);
      entries.set(p.id, entry);
    }
  }
  // One more ask for what didn't fit, saying how long the last try was.
  const retry = todo.filter((p) => {
    const e = entries.get(p.id);
    return !e?.cardLine || (needsCardName(p.name) && !e.cardName);
  });
  if (retry.length > 0) {
    console.log(`cards: asking again for ${retry.length} that didn't fit`);
    for (const batch of batches(retry, BATCH_SIZE)) {
      const drafted = await ask(apiKey, batch, tooLong);
      for (const p of batch) {
        const again = fit(p, drafted.get(p.id));
        const before = entries.get(p.id);
        entries.set(p.id, {
          ...again,
          cardLine: before?.cardLine ?? again.cardLine,
          cardName: before?.cardName ?? again.cardName,
        });
      }
    }
  }
  const list = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
  const missing = checkReview(list);
  console.log(`cards: wrote ${list.length} places to ${file}`);
  if (missing.length > 0) {
    console.log(`cards: ${missing.length} still need copy by hand:\n  ${missing.join('\n  ')}`);
  }
  console.log(`cards: read and edit ${file}, then: npm run cards -- save ${file}`);
}

async function save(file: string): Promise<void> {
  const entries: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const problems = checkReview(entries);
  if (problems.length > 0) {
    console.error(`cards: nothing saved; fix these first:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  // Production's, as the drafts read production's catalog; never .env.local,
  // which a plain `vercel env pull` fills with development's.
  const env = resolve(process.cwd(), '.env.prod');
  if (!existsSync(env)) {
    throw new Error(
      'cards: no .env.prod; run `vercel env pull .env.prod --environment=production`',
    );
  }
  process.loadEnvFile(env);
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('cards: .env.prod has no TURSO_DATABASE_URL');
  const list = entries as Entry[];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `cards: write ${list.length} places' card copy to ${new URL(url).host}? [y/N] `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('cards: nothing saved');
    return;
  }
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const results = await db.batch(saveStatements(list), 'write');
  const skipped = list.filter((_, i) => results[i]?.rowsAffected === 0);
  console.log(`cards: saved ${list.length - skipped.length} places`);
  if (skipped.length > 0) {
    console.log(
      `cards: left alone, gone from the catalog or edited since the draft: ${skipped.map((e) => e.name).join(', ')}`,
    );
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const [step, ...rest] = argv;
  const file = rest.find((a) => !a.startsWith('--')) ?? DEFAULT_FILE;
  if (step === 'draft') return draft(file, rest.includes('--all'));
  if (step === 'save') return save(file);
  throw new Error('usage: npm run cards -- draft [file] [--all] | save [file]');
}

runAsScript(import.meta.url, main);
