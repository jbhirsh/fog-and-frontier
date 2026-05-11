#!/usr/bin/env node
/**
 * One-shot: upsert every activity from src/data/activities.ts into Turso.
 * Run once per Turso DB. Idempotent — INSERT … ON CONFLICT(id) DO UPDATE.
 *
 * Why: src/data/activities.ts has been merged into the client at render time
 * alongside Turso rows, so an empty Turso DB still "looked fine" to visitors
 * (incident #24). After running this, Turso is the single source of truth and
 * the static file + merge in useAllActivities can be removed (issue #21).
 *
 * Usage:
 *   vercel env pull .env.prod --environment=production
 *   npm run db:migrate-static
 *   # or with a different env file:
 *   TURSO_ENV_FILE=.env.preview npm run db:migrate-static
 *
 * Run under Node 22.6+ or 24 with --experimental-strip-types so the .ts import
 * works without a build step. The npm-script wraps this; invoking node
 * directly without the flag will fail with ERR_UNKNOWN_FILE_EXTENSION.
 */

import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const envFile = process.env.TURSO_ENV_FILE ?? '.env.prod';
const envPath = resolve(process.cwd(), envFile);
if (!existsSync(envPath)) {
  console.error(`Missing ${envFile}. Run: vercel env pull ${envFile} --environment=<env>`);
  process.exit(2);
}
process.loadEnvFile(envPath);

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error(`TURSO_DATABASE_URL not set in ${envFile}.`);
  process.exit(2);
}

const { activities } = await import('../src/data/activities.ts');
if (!Array.isArray(activities) || activities.length === 0) {
  console.error('No static activities found — refusing to run.');
  process.exit(2);
}

const dups = new Set();
const seen = new Set();
for (const a of activities) {
  if (seen.has(a.id)) dups.add(a.id);
  seen.add(a.id);
}
if (dups.size > 0) {
  console.error(`Duplicate ids in static seed: ${[...dups].join(', ')}`);
  process.exit(2);
}

console.log(`Target: ${url}`);
console.log(`Static activities to upsert: ${activities.length}`);

const client = createClient({ url, authToken: token });
await client.execute(
  'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
);

const existing = await client.execute('SELECT id FROM a');
const existingIds = new Set(existing.rows.map((r) => String(r.id)));
console.log(`Existing rows in Turso: ${existingIds.size}`);

const collisions = activities.filter((a) => existingIds.has(a.id));
if (collisions.length > 0) {
  console.log(`Collisions (will overwrite ${collisions.length}):`);
  for (const a of collisions) console.log(`  - ${a.id}`);
}

const rl = createInterface({ input: stdin, output: stdout });
const ans = (await rl.question(`Proceed with upserting ${activities.length} rows? [y/N] `)).trim().toLowerCase();
rl.close();
if (ans !== 'y') {
  console.log('Aborted.');
  process.exit(0);
}

const now = Date.now();
let written = 0;
for (const a of activities) {
  await client.execute({
    sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
    args: [a.id, JSON.stringify(a), now],
  });
  written++;
}

console.log(`Wrote ${written} rows.`);
const after = await client.execute('SELECT COUNT(*) AS n FROM a');
console.log(`Turso now has ${after.rows[0].n} total rows.`);
