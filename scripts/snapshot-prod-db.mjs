#!/usr/bin/env node
/**
 * Dump the prod Turso DB to a local SQLite file for `vercel dev` to read from.
 * Reads TURSO_DATABASE_URL + TURSO_AUTH_TOKEN from env (run `vercel env pull
 * .env.local` first, then source it). Writes to ./dev-db.sqlite (gitignored).
 *
 * One snapshot is enough for ordinary local dev. Re-run when prod data shape
 * changes or you need fresh fixtures.
 */

import { createClient } from '@libsql/client';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';

// Load .env.local if present (Vercel env pull writes to this path)
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const sourceUrl = process.env.TURSO_DATABASE_URL;
const sourceToken = process.env.TURSO_AUTH_TOKEN;
const targetPath = process.env.DEV_DB_PATH ?? 'dev-db.sqlite';

if (!sourceUrl) {
  console.error('TURSO_DATABASE_URL not set. Run `vercel env pull .env.local` first.');
  process.exit(2);
}

if (existsSync(targetPath)) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `${targetPath} already exists and will be OVERWRITTEN (local dev changes will be lost). Continue? [y/N] `,
  );
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Aborted.');
    process.exit(0);
  }
  unlinkSync(targetPath);
}

console.log(`Connecting to prod Turso...`);
const source = createClient({ url: sourceUrl, authToken: sourceToken });

console.log(`Opening local SQLite at ${targetPath}...`);
const target = createClient({ url: `file:${targetPath}` });

// Schema mirrors what api/activities.ts and api/completed.ts create on first
// run. Keep in sync if those schemas change.
await target.execute(
  'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
);
await target.execute(
  'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
);

async function copyTable(name, columns, valueFor) {
  const rs = await source.execute(`SELECT ${columns.join(', ')} FROM ${name}`);
  console.log(`Copying ${rs.rows.length} rows from ${name}...`);
  for (const row of rs.rows) {
    const args = columns.map((col) => valueFor(col, row[col]));
    const placeholders = columns.map(() => '?').join(', ');
    await target.execute({
      sql: `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${placeholders})`,
      args,
    });
  }
}

await copyTable('a', ['id', 'j', 't'], (col, val) => {
  if (col === 't') return Number(val);
  return String(val);
});

await copyTable('c', ['id', 'v'], (col, val) => {
  if (col === 'v') return Number(val);
  return String(val);
});

console.log(`\nDone. Snapshot at ${targetPath}.`);
console.log(`To use in dev: DEV_DB_PATH=${targetPath} vercel dev`);
