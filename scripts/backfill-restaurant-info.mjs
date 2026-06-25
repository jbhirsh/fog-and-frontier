#!/usr/bin/env node
/**
 * Additive backfill: set the restaurant fields (#76) — cuisine, priceRange,
 * hours, reservationUrl, menuUrl, dietary — on existing Turso `food` rows,
 * WITHOUT clobbering any other fields. Same safety model as
 * backfill-park-types.mjs: Turso is the live source of truth; the static seed
 * only seeds a fresh DB.
 *
 * Values come from the static seed (entries that already declare restaurant
 * fields) plus an EXTRAS map for food rows that exist only in prod (added via
 * the in-app Add flow, never in the seed). New activities added going forward
 * get these fields from Gemini at creation time (api/generate-activity.ts).
 *
 * Usage:
 *   vercel env pull .env.prod --environment=production
 *   npm run db:backfill-restaurant-info -- --dry-run   # preview, never writes
 *   npm run db:backfill-restaurant-info                # interactive [y/N]
 *   npm run db:backfill-restaurant-info -- --yes       # skip the prompt
 */

import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const assumeYes = argv.includes('--yes') || argv.includes('-y');

const envFile = process.env.TURSO_ENV_FILE ?? '.env.prod';
const envPath = resolve(process.cwd(), envFile);
if (!existsSync(envPath)) {
  console.error(
    `Missing ${envFile}. Run: vercel env pull ${envFile} --environment=<env>`,
  );
  process.exit(2);
}
process.loadEnvFile(envPath);

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error(`TURSO_DATABASE_URL not set in ${envFile}.`);
  process.exit(2);
}

const FIELDS = [
  'cuisine',
  'priceRange',
  'hours',
  'reservationUrl',
  'menuUrl',
  'dietary',
];

const { activities } = await import('../src/data/activities.ts');
// Seed-derived: pick only the restaurant fields that are present.
const desired = new Map();
for (const a of activities) {
  const fields = {};
  for (const k of FIELDS) if (a[k] !== undefined) fields[k] = a[k];
  if (Object.keys(fields).length > 0) desired.set(a.id, fields);
}

// Restaurants created directly in Turso (not in the static seed).
const EXTRAS = {
  'big-sur-river-inn': {
    cuisine: 'Californian · American',
    priceRange: '$$$',
    menuUrl: 'https://www.bigsurriverinn.com/',
    dietary: ['vegetarian'],
  },
  'shadowbrook-restaurant-capitola': {
    cuisine: 'Californian',
    priceRange: '$$$',
    menuUrl: 'https://www.shadowbrook-capitola.com/',
    dietary: ['vegetarian', 'gluten-free'],
  },
};
for (const [id, fields] of Object.entries(EXTRAS)) {
  if (!desired.has(id)) desired.set(id, fields);
}

if (desired.size === 0) {
  console.error('No restaurant fields to backfill.');
  process.exit(2);
}

console.log(`Target: ${url}`);
console.log(`Restaurants with fields to apply: ${desired.size}`);

const client = createClient({ url, authToken: token });

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const plan = []; // { id, fields, j }
const missing = [];
for (const [id, fields] of desired) {
  const rs = await client.execute({
    sql: 'SELECT j FROM a WHERE id = ?',
    args: [id],
  });
  if (rs.rows.length === 0 || typeof rs.rows[0].j !== 'string') {
    missing.push(id);
    continue;
  }
  let obj;
  try {
    obj = JSON.parse(rs.rows[0].j);
  } catch {
    console.warn(`  ! ${id}: malformed JSON in Turso — skipping`);
    continue;
  }
  // Restaurant fields only belong on food rows (Option A, #76). Guard against
  // an id whose prod category isn't 'food'.
  if (obj.category !== 'food') {
    console.warn(`  ! ${id}: category is "${obj.category}", not food — skipping`);
    continue;
  }
  // Only the keys that actually differ from what's already stored.
  const changed = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!eq(obj[k], v)) changed[k] = v;
  }
  if (Object.keys(changed).length === 0) continue; // already correct
  plan.push({ id, fields: changed, j: { ...obj, ...changed } });
}

if (missing.length) {
  console.log(
    `\nIn assignments but not in Turso (${missing.length}, skipped): ${missing.join(', ')}`,
  );
}

if (plan.length === 0) {
  console.log('\nNothing to update — Turso already matches.');
  process.exit(0);
}

console.log(`\nWill update ${plan.length} restaurant row(s):`);
for (const p of plan) {
  console.log(`  - ${p.id}: ${Object.keys(p.fields).join(', ')}`);
}

if (dryRun) {
  console.log('\n--dry-run: no changes written.');
  process.exit(0);
}

if (!assumeYes) {
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question(`\nProceed? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (ans !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }
}

const now = Date.now();
let written = 0;
for (const p of plan) {
  const json = JSON.stringify(p.j);
  if (json.length > 8000) {
    console.warn(`  ! ${p.id}: would exceed 8000-char cap — skipping`);
    continue;
  }
  await client.execute({
    sql: 'UPDATE a SET j = ?, t = ? WHERE id = ?',
    args: [json, now, p.id],
  });
  written++;
}

console.log(`\nUpdated ${written} row(s).`);
