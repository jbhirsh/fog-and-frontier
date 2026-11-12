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
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { runAsScript } from './run-as-script.ts';

/** Asks a question on the terminal and resolves to the answer. */
async function askTerminal(/** @type {string} */ question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Copies production's tables into the local file; resolves to the exit code.
 * It takes no arguments; the database client and the prompt come in as
 * dependencies, for the tests.
 * @param {readonly string[]} _argv
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   connect?: typeof createClient,
 *   ask?: (question: string) => Promise<string>,
 * }} [deps]
 * @returns {Promise<number>}
 */
export async function main(
  _argv,
  { env = process.env, cwd = process.cwd(), connect = createClient, ask = askTerminal } = {},
) {
  // .env.local, if present (Vercel env pull writes to this path), read with
  // Node's own parser so values containing '=' or quotes round-trip; a
  // variable already set wins, as with process.loadEnvFile.
  const envPath = resolve(cwd, '.env.local');
  const vars = existsSync(envPath) ? { ...parseEnv(readFileSync(envPath, 'utf8')), ...env } : env;

  const sourceUrl = vars.TURSO_DATABASE_URL;
  const sourceToken = vars.TURSO_AUTH_TOKEN;
  const targetPath = vars.DEV_DB_PATH ?? 'dev-db.sqlite';
  const targetFile = resolve(cwd, targetPath);

  if (!sourceUrl) {
    console.error('TURSO_DATABASE_URL not set. Run `vercel env pull .env.local` first.');
    return 2;
  }

  if (existsSync(targetFile)) {
    const answer = await ask(
      `${targetPath} already exists and will be OVERWRITTEN (local dev changes will be lost). Continue? [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Aborted.');
      return 0;
    }
    unlinkSync(targetFile);
  }

  console.log(`Connecting to prod Turso...`);
  const source = connect({ url: sourceUrl, authToken: sourceToken });

  console.log(`Opening local SQLite at ${targetPath}...`);
  const target = connect({ url: `file:${targetFile}` });

  // Schema mirrors what api/activities.ts and api/completed.ts create on first
  // run. Keep in sync if those schemas change.
  await target.execute(
    'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
  );
  await target.execute('CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)');

  /**
   * @param {string} name
   * @param {string[]} columns
   * @param {string} numeric the column stored as a number; the rest as text
   */
  async function copyTable(name, columns, numeric) {
    const rs = await source.execute(`SELECT ${columns.join(', ')} FROM ${name}`);
    console.log(`Copying ${rs.rows.length} rows from ${name}...`);
    for (const row of rs.rows) {
      const args = columns.map((col) => (col === numeric ? Number(row[col]) : String(row[col])));
      const placeholders = columns.map(() => '?').join(', ');
      await target.execute({
        sql: `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${placeholders})`,
        args,
      });
    }
  }

  await copyTable('a', ['id', 'j', 't'], 't');
  await copyTable('c', ['id', 'v'], 'v');

  console.log(`\nDone. Snapshot at ${targetPath}.`);
  console.log(`To use in dev: DEV_DB_PATH=${targetPath} vercel dev`);
  return 0;
}

runAsScript(import.meta.url, main);
