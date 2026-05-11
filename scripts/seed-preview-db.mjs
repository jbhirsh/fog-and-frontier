#!/usr/bin/env node
/**
 * Seed the Preview Turso DB from Production Turso so PR previews have the
 * same activities as prod. The smoke gate's sentinel-activity check then
 * passes against PR preview deploys.
 *
 * One-shot, idempotent. Run again after adding new activities in prod that
 * smoke depends on, or after rotating preview Turso credentials.
 *
 * Usage:
 *   1. Pull both env scopes into local files:
 *        vercel env pull .env.prod    --environment=production
 *        vercel env pull .env.preview --environment=preview
 *   2. Run:
 *        npm run db:seed-preview
 *
 * Refuses to run if both URLs match (would seed prod from prod — pointless
 * and confusing). Prints a diff summary and prompts y/N before any writes.
 */

import { createClient } from '@libsql/client';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const PROD_ENV_FILE = '.env.prod';
const PREVIEW_ENV_FILE = '.env.preview';

function loadEnvFile(path) {
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run: vercel env pull ${path} --environment=${path.replace('.env.', '')}`);
    process.exit(2);
  }
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const prodEnv = loadEnvFile(PROD_ENV_FILE);
const previewEnv = loadEnvFile(PREVIEW_ENV_FILE);

const PROD_URL = prodEnv.TURSO_DATABASE_URL;
const PROD_TOKEN = prodEnv.TURSO_AUTH_TOKEN;
const PREVIEW_URL = previewEnv.TURSO_DATABASE_URL;
const PREVIEW_TOKEN = previewEnv.TURSO_AUTH_TOKEN;

for (const [name, val] of [
  ['prod TURSO_DATABASE_URL', PROD_URL],
  ['prod TURSO_AUTH_TOKEN', PROD_TOKEN],
  ['preview TURSO_DATABASE_URL', PREVIEW_URL],
  ['preview TURSO_AUTH_TOKEN', PREVIEW_TOKEN],
]) {
  if (!val) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
}

if (PROD_URL === PREVIEW_URL) {
  console.error('PROD and PREVIEW TURSO_DATABASE_URL are identical — they already share a database, no seed needed.');
  console.error(`URL: ${PROD_URL}`);
  process.exit(2);
}

console.log(`Reading from prod:   ${PROD_URL}`);
console.log(`Writing to preview:  ${PREVIEW_URL}`);

const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
const preview = createClient({ url: PREVIEW_URL, authToken: PREVIEW_TOKEN });

const activities = (await prod.execute('SELECT id, j, t FROM a ORDER BY t DESC')).rows;
const completed = (await prod.execute('SELECT id, v FROM c')).rows;

console.log(`Prod has ${activities.length} activities and ${completed.length} completed entries.`);
if (activities.length === 0) {
  console.error('Prod has no activities — nothing to seed. Aborting.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ans = (await rl.question('Proceed with overwriting preview? [y/N] ')).trim().toLowerCase();
rl.close();
if (ans !== 'y') {
  console.log('Aborted.');
  process.exit(0);
}

await preview.execute('CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)');
await preview.execute('CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)');

let aCount = 0;
for (const row of activities) {
  await preview.execute({
    sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
    args: [String(row.id), String(row.j), Number(row.t)],
  });
  aCount++;
}

let cCount = 0;
for (const row of completed) {
  await preview.execute({
    sql: 'INSERT INTO c (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v',
    args: [String(row.id), Number(row.v)],
  });
  cCount++;
}

console.log(`Wrote ${aCount} activities and ${cCount} completed entries to preview.`);
