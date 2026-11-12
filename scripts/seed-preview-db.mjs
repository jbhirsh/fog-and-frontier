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
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runAsScript } from './run-as-script.ts';

const PROD_ENV_FILE = '.env.prod';
const PREVIEW_ENV_FILE = '.env.preview';

/** Asks a question on the terminal and resolves to the answer. */
async function askTerminal(/** @type {string} */ question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * An env file's variables, or null (having said how to make it) when it's
 * missing.
 * @param {string} cwd
 * @param {string} file
 * @returns {Record<string, string> | null}
 */
export function loadEnvFile(cwd, file) {
  const path = resolve(cwd, file);
  if (!existsSync(path)) {
    console.error(
      `Missing ${file}. Run: vercel env pull ${file} --environment=${file.replace('.env.', '')}`,
    );
    return null;
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Seeds preview from production, once the owner confirms; resolves to the
 * exit code. It takes no arguments; the database client and the prompt come
 * in as dependencies, for the tests.
 * @param {readonly string[]} _argv
 * @param {{
 *   cwd?: string,
 *   connect?: typeof createClient,
 *   ask?: (question: string) => Promise<string>,
 * }} [deps]
 * @returns {Promise<number>}
 */
export async function main(
  _argv,
  { cwd = process.cwd(), connect = createClient, ask = askTerminal } = {},
) {
  const prodEnv = loadEnvFile(cwd, PROD_ENV_FILE);
  const previewEnv = prodEnv && loadEnvFile(cwd, PREVIEW_ENV_FILE);
  if (!prodEnv || !previewEnv) return 2;

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
      return 2;
    }
  }

  if (PROD_URL === PREVIEW_URL) {
    console.error(
      'PROD and PREVIEW TURSO_DATABASE_URL are identical — they already share a database, no seed needed.',
    );
    console.error(`URL: ${PROD_URL}`);
    return 2;
  }

  console.log(`Reading from prod:   ${PROD_URL}`);
  console.log(`Writing to preview:  ${PREVIEW_URL}`);

  const prod = connect({ url: PROD_URL, authToken: PROD_TOKEN });
  const preview = connect({ url: PREVIEW_URL, authToken: PREVIEW_TOKEN });

  const activities = (await prod.execute('SELECT id, j, t FROM a ORDER BY t DESC')).rows;
  const completed = (await prod.execute('SELECT id, v FROM c')).rows;

  console.log(
    `Prod has ${activities.length} activities and ${completed.length} completed entries.`,
  );
  if (activities.length === 0) {
    console.error('Prod has no activities — nothing to seed. Aborting.');
    return 1;
  }

  const ans = (await ask('Proceed with overwriting preview? [y/N] ')).trim().toLowerCase();
  if (ans !== 'y') {
    console.log('Aborted.');
    return 0;
  }

  await preview.execute(
    'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
  );
  await preview.execute('CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)');

  for (const row of activities) {
    await preview.execute({
      sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
      args: [String(row.id), String(row.j), Number(row.t)],
    });
  }
  for (const row of completed) {
    await preview.execute({
      sql: 'INSERT INTO c (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v',
      args: [String(row.id), Number(row.v)],
    });
  }

  console.log(
    `Wrote ${activities.length} activities and ${completed.length} completed entries to preview.`,
  );
  return 0;
}

runAsScript(import.meta.url, main);
