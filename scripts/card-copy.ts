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
//
// The same two steps find each dog-friendly place's dog rules page (#296):
//
//   npm run cards -- dogs draft [review.json] [--all]
//     asks Gemini, with Google Search, for the page where each dog-friendly
//     place without one (every one with --all), or its park, states its dog
//     rules, a few places a call, and writes dog-rules.review.json by
//     default. A page that isn't the place's or its park's own (a listing
//     site's, or a search redirect) is written as null.
//
//   npm run cards -- dogs save [review.json]
//     saves the pages the owner kept, as the card copy is saved. A null
//     saves nothing for that place.
//
// The searches are paid only past Gemini's free daily allowance, which the
// catalog's 128 dog-friendly places fit within.

import { createClient } from '@libsql/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CARD_LINE_MAX, CARD_NAME_MAX } from '../shared/cardCopy.ts';
import { isListingSite } from '../shared/dogRules.ts';
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

/** A Gemini answer's places, each as it came, by id; anything unreadable is left out. */
export function parsePlaces(reply: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  // A grounded answer can come in several parts; the JSON is all of them.
  const parts = (reply as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)
    ?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
    : '';
  if (!text) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  const places = (parsed as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return out;
  for (const p of places as unknown[]) {
    if (!p || typeof p !== 'object') continue;
    const place = p as Record<string, unknown>;
    if (typeof place.id === 'string') out.set(place.id, place);
  }
  return out;
}

/** A Gemini answer's copy, by place id; anything unreadable is left out. */
export function parseReply(reply: unknown): Map<string, { cardLine: unknown; cardName: unknown }> {
  const out = new Map<string, { cardLine: unknown; cardName: unknown }>();
  for (const [id, { cardLine, cardName }] of parsePlaces(reply))
    out.set(id, { cardLine, cardName });
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

/**
 * What's wrong with a reviewed file: not a list, or a place with no id or
 * listed twice, then whatever `check` finds in each place, by its name.
 */
function reviewEach(
  entries: unknown,
  check: (label: string, entry: Record<string, unknown>) => string[],
): string[] {
  if (!Array.isArray(entries)) return ['the file must hold a list of places'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, e] of (entries as unknown[]).entries()) {
    const entry = (e ?? {}) as Record<string, unknown>;
    const { id, name } = entry;
    const label = typeof name === 'string' && name ? name : `place ${i + 1}`;
    if (typeof id !== 'string' || !id) {
      problems.push(`${label}: no id`);
      continue;
    }
    if (seen.has(id)) problems.push(`${label}: listed twice`);
    seen.add(id);
    problems.push(...check(label, entry));
  }
  return problems;
}

/** What's wrong with a reviewed file, place by place; empty when it can be saved. */
export function checkReview(entries: unknown): string[] {
  return reviewEach(entries, (label, { cardLine, cardName }) => {
    const problems: string[] = [];
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
    return problems;
  });
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

// --- dog rules (#296) --------------------------------------------------------

const DOGS_FILE = 'dog-rules.review.json';

/** Dog-friendly places asked about in one searching call. */
export const DOG_BATCH_SIZE = 8;

/** A dog-friendly place as the catalog gives it to the drafts. */
export interface DogPlace {
  id: string;
  name: string;
  city: string;
  /** The park it's part of (#269), by name, which may publish its rules. */
  park: string | null;
  dogRulesUrl: string | null;
}

/** A place's dog rules page as the review file holds it. */
export interface DogEntry {
  id: string;
  name: string;
  city: string;
  dogRulesUrl: string | null;
  /** The page the catalog held when drafted; a place whose page has changed since isn't saved. */
  stored?: { dogRulesUrl: string | null };
}

/** The dog-friendly places to draft: those without a page, or every one with `all`. */
export function dogPlacesToDraft(places: readonly DogPlace[], all: boolean): DogPlace[] {
  return places.filter((p) => all || !p.dogRulesUrl?.trim());
}

/**
 * A page that can be kept as a place's dog rules: an http(s) page that
 * isn't a search redirect or a listing site's (shared/dogRules.ts), as the
 * API holds a draft's. Null for anything else.
 */
export function dogRulesPage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === 'vertexaisearch.cloud.google.com' || isListingSite(url.hostname)) {
    return null;
  }
  return url.href;
}

const DOG_SYSTEM = `For each dog-friendly place, find with Google Search the page where the place itself, or the park it is part of, states its dog rules: where dogs may go, and on what leash. Its own site or its park agency's (a state, county, regional or city parks department, a national park's), never a listing or review site (AllTrails, BringFido, Yelp, TripAdvisor) and never a news story.
Give the page's own address as you found it, never a vertexaisearch.cloud.google.com redirect, and never construct one. Omit "dogRulesUrl" for a place where you find no such page. Answer for every place, by its id.`;

/** The JSON Gemini is held to for dog rules: one entry per place, by id. */
export const DOG_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, dogRulesUrl: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  required: ['places'],
};

/** What one call asks about: each place, its town and park. */
export function dogPrompt(places: readonly DogPlace[]): string {
  return JSON.stringify(
    places.map((p) => ({ id: p.id, name: p.name, city: p.city, partOf: p.park ?? undefined })),
  );
}

/** A place's drafted page, kept only if it can be (see {@link dogRulesPage}). */
export function fitDogs(place: DogPlace, drafted: Record<string, unknown> | undefined): DogEntry {
  return {
    id: place.id,
    name: place.name,
    city: place.city,
    dogRulesUrl: dogRulesPage(drafted?.dogRulesUrl),
    stored: { dogRulesUrl: place.dogRulesUrl },
  };
}

/** What's wrong with a reviewed dog rules file, place by place; empty when it can be saved. */
export function checkDogReview(entries: unknown): string[] {
  return reviewEach(entries, (label, { dogRulesUrl }) =>
    dogRulesUrl !== null && dogRulesUrl !== undefined && !dogRulesPage(dogRulesUrl)
      ? [`${label}: dog rules page isn't the place's own web page`]
      : [],
  );
}

/**
 * The statements that save a checked dog rules file: each page found set in
 * its place's stored JSON, while the place still holds the page the draft
 * started from, its last-edited time left alone. A place left null saves
 * nothing.
 */
export function dogSaveStatements(entries: readonly DogEntry[]) {
  return entries.flatMap((e) => {
    const page = dogRulesPage(e.dogRulesUrl);
    if (!page) return [];
    return [
      {
        sql:
          "UPDATE a SET j = json_set(j, '$.dogRulesUrl', ?) WHERE id = ?" +
          " AND json_extract(j, '$.dogRulesUrl') IS ?",
        args: [page, e.id, e.stored?.dogRulesUrl ?? null],
      },
    ];
  });
}

// --- the steps ---------------------------------------------------------------

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env.local');
  if (existsSync(path)) process.loadEnvFile(path);
}

function geminiKey(): string {
  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('cards: GEMINI_API_KEY not set; run `vercel env pull .env.local`');
  return apiKey;
}

async function readCatalog<T>(fields: string): Promise<T[]> {
  const r = await fetch(CATALOG, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `{ activities { ${fields} } }` }),
  });
  const json = (await r.json()) as {
    data?: { activities?: T[] };
    errors?: { message: string }[];
  };
  if (!json.data?.activities) {
    throw new Error(
      `cards: the catalog couldn't be read (${json.errors?.[0]?.message ?? r.status}); is it deployed?`,
    );
  }
  return json.data.activities;
}

async function readPlaces(): Promise<Place[]> {
  const rows = await readCatalog<Omit<Place, 'city'> & { location: { city: string } }>(
    'id name shortDescription category location { city } cardLine cardName',
  );
  return rows.map(({ location, ...p }) => ({ ...p, city: location.city }));
}

async function readDogPlaces(): Promise<DogPlace[]> {
  const rows = await readCatalog<{
    id: string;
    name: string;
    dogFriendly: boolean | null;
    dogRulesUrl: string | null;
    parentId: string | null;
    location: { city: string };
  }>('id name dogFriendly dogRulesUrl parentId location { city }');
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return rows
    .filter((r) => r.dogFriendly === true)
    .map((r) => ({
      id: r.id,
      name: r.name,
      city: r.location.city,
      park: (r.parentId && names.get(r.parentId)) || null,
      dogRulesUrl: r.dogRulesUrl,
    }));
}

async function askGemini(
  apiKey: string,
  ask: { system: string; prompt: string; schema: unknown; search: boolean },
) {
  const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ask.system }] },
      contents: [{ role: 'user', parts: [{ text: ask.prompt }] }],
      ...(ask.search ? { tools: [{ googleSearch: {} }] } : {}),
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: ask.schema,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
  });
  if (!r.ok)
    throw new Error(`cards: Gemini answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as unknown;
}

async function ask(apiKey: string, places: readonly Place[], tooLong?: Map<string, string>) {
  return parseReply(
    await askGemini(apiKey, {
      system: SYSTEM,
      prompt: prompt(places, tooLong),
      schema: REPLY_SCHEMA,
      search: false,
    }),
  );
}

async function draft(file: string, all: boolean): Promise<void> {
  const apiKey = geminiKey();
  const todo = placesToDraft(await readPlaces(), all);
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

async function dogsDraft(file: string, all: boolean): Promise<void> {
  const apiKey = geminiKey();
  const todo = dogPlacesToDraft(await readDogPlaces(), all);
  console.log(
    `cards: finding dog rules for ${todo.length} places in ${Math.ceil(todo.length / DOG_BATCH_SIZE)} calls`,
  );
  const entries: DogEntry[] = [];
  for (const batch of batches(todo, DOG_BATCH_SIZE)) {
    const drafted = parsePlaces(
      await askGemini(apiKey, {
        system: DOG_SYSTEM,
        prompt: dogPrompt(batch),
        schema: DOG_REPLY_SCHEMA,
        search: true,
      }),
    );
    for (const p of batch) entries.push(fitDogs(p, drafted.get(p.id)));
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
  const found = entries.filter((e) => e.dogRulesUrl).length;
  console.log(`cards: wrote ${entries.length} places to ${file}, ${found} with a page`);
  console.log(
    `cards: open each page, fix or null any that's wrong, then: npm run cards -- dogs save ${file}`,
  );
}

/**
 * Writes checked statements to production's Turso in one batch, once the
 * owner confirms the host, and says which places were left alone.
 */
async function writeToProduction(
  what: string,
  rows: readonly { name: string }[],
  statements: readonly { sql: string; args: (string | null)[] }[],
): Promise<void> {
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
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `cards: write ${rows.length} places' ${what} to ${new URL(url).host}? [y/N] `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('cards: nothing saved');
    return;
  }
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const results = await db.batch([...statements], 'write');
  const skipped = rows.filter((_, i) => results[i]?.rowsAffected === 0);
  console.log(`cards: saved ${rows.length - skipped.length} places`);
  if (skipped.length > 0) {
    console.log(
      `cards: left alone, gone from the catalog or edited since the draft: ${skipped.map((e) => e.name).join(', ')}`,
    );
  }
}

function readReview(file: string, check: (entries: unknown) => string[]): unknown[] | null {
  const entries: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const problems = check(entries);
  if (problems.length > 0) {
    console.error(`cards: nothing saved; fix these first:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
    return null;
  }
  return entries as unknown[];
}

async function save(file: string): Promise<void> {
  const list = readReview(file, checkReview) as Entry[] | null;
  if (list) await writeToProduction('card copy', list, saveStatements(list));
}

async function dogsSave(file: string): Promise<void> {
  const list = readReview(file, checkDogReview) as DogEntry[] | null;
  if (!list) return;
  // One statement per place with a page, in order, so results line up.
  const found = list.filter((e) => dogRulesPage(e.dogRulesUrl));
  await writeToProduction('dog rules pages', found, dogSaveStatements(found));
}

const USAGE =
  'usage: npm run cards -- draft [file] [--all] | save [file] | dogs draft [file] [--all] | dogs save [file]';

export async function main(argv: readonly string[]): Promise<void> {
  const dogs = argv[0] === 'dogs';
  const [step, ...rest] = dogs ? argv.slice(1) : argv;
  const file = rest.find((a) => !a.startsWith('--')) ?? (dogs ? DOGS_FILE : DEFAULT_FILE);
  const all = rest.includes('--all');
  if (step === 'draft') return dogs ? dogsDraft(file, all) : draft(file, all);
  if (step === 'save') return dogs ? dogsSave(file) : save(file);
  throw new Error(USAGE);
}

runAsScript(import.meta.url, main);
