import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './snapshot-prod-db.mjs';

const question = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const createInterface = vi.hoisted(() => vi.fn(() => ({ question, close })));
vi.mock('node:readline/promises', () => ({ createInterface }));

/** Fake libSQL clients: production answers SELECTs from `tables`; each logs. */
function fakeTurso(tables) {
  const opened = [];
  const connect = vi.fn((config) => {
    const executed = [];
    opened.push({ config, executed });
    return {
      execute: vi.fn(async (stmt) => {
        executed.push(stmt);
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        const from = sql.match(/^SELECT .* FROM (\w+)$/);
        return { rows: from ? (tables[from[1]] ?? []) : [] };
      }),
    };
  });
  return { connect, opened };
}

let cwd;
let log;
let error;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'snapshot-'));
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
const logged = () => log.mock.calls.map((c) => c[0]);
afterEach(() => vi.restoreAllMocks());

const env = { TURSO_DATABASE_URL: 'libsql://prod.turso.io', TURSO_AUTH_TOKEN: 'token' };

describe('main', () => {
  it("copies production's activities and completions into the local file", async () => {
    const turso = fakeTurso({
      a: [{ id: 'muir', j: '{"name":"Muir Woods"}', t: 1700n }],
      c: [{ id: 'muir', v: 1n }],
    });
    expect(await main([], { env, cwd, connect: turso.connect, ask: vi.fn() })).toBe(0);
    const [source, target] = turso.opened;
    expect(source.config).toEqual({ url: 'libsql://prod.turso.io', authToken: 'token' });
    expect(target.config).toEqual({ url: `file:${join(cwd, 'dev-db.sqlite')}` });
    expect(target.executed).toEqual([
      'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
      {
        sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?)',
        args: ['muir', '{"name":"Muir Woods"}', 1700],
      },
      { sql: 'INSERT INTO c (id, v) VALUES (?, ?)', args: ['muir', 1] },
    ]);
    expect(logged()).toEqual([
      'Connecting to prod Turso...',
      'Opening local SQLite at dev-db.sqlite...',
      'Copying 1 rows from a...',
      'Copying 1 rows from c...',
      '\nDone. Snapshot at dev-db.sqlite.',
      'To use in dev: DEV_DB_PATH=dev-db.sqlite vercel dev',
    ]);
  });

  it('reads production from .env.local, where a variable already set wins', async () => {
    writeFileSync(
      join(cwd, '.env.local'),
      'TURSO_DATABASE_URL="libsql://from-file.turso.io"\nDEV_DB_PATH=snap.sqlite\n',
    );
    const turso = fakeTurso({});
    await main([], { env: {}, cwd, connect: turso.connect, ask: vi.fn() });
    expect(turso.opened[0].config.url).toBe('libsql://from-file.turso.io');
    expect(turso.opened[1].config.url).toBe(`file:${join(cwd, 'snap.sqlite')}`);
    const set = fakeTurso({});
    await main([], { env, cwd, connect: set.connect, ask: vi.fn() });
    expect(set.opened[0].config.url).toBe('libsql://prod.turso.io');
  });

  it('refuses to run without a production URL', async () => {
    const turso = fakeTurso({});
    expect(await main([], { env: {}, cwd, connect: turso.connect, ask: vi.fn() })).toBe(2);
    expect(turso.connect).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'TURSO_DATABASE_URL not set. Run `vercel env pull .env.local` first.',
    );
  });

  it('asks before overwriting a snapshot, and keeps it unless told yes', async () => {
    const file = join(cwd, 'dev-db.sqlite');
    writeFileSync(file, 'old');
    const turso = fakeTurso({});
    const no = vi.fn(async () => 'n');
    expect(await main([], { env, cwd, connect: turso.connect, ask: no })).toBe(0);
    expect(no).toHaveBeenCalledWith(expect.stringContaining('dev-db.sqlite already exists'));
    expect(existsSync(file)).toBe(true);
    expect(turso.connect).not.toHaveBeenCalled();
    expect(logged()).toEqual(['Aborted.']);
    // Only a whole "y" or "yes" goes ahead.
    for (const answer of ['ye', 'yess', 'okay yes', 'yo']) {
      expect(await main([], { env, cwd, connect: turso.connect, ask: async () => answer })).toBe(0);
    }
    expect(turso.connect).not.toHaveBeenCalled();
    expect(await main([], { env, cwd, connect: turso.connect, ask: async () => 'y' })).toBe(0);
    expect(turso.connect).toHaveBeenCalledTimes(2);
    writeFileSync(file, 'old');
    expect(await main([], { env, cwd, connect: turso.connect, ask: async () => ' Yes ' })).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(turso.connect).toHaveBeenCalledTimes(4);
  });

  it('asks on the terminal by default, and closes it', async () => {
    writeFileSync(join(cwd, 'dev-db.sqlite'), 'old');
    question.mockResolvedValueOnce('');
    expect(await main([], { env, cwd, connect: fakeTurso({}).connect })).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('Continue? [y/N]'));
    expect(createInterface).toHaveBeenCalledWith({ input: process.stdin, output: process.stdout });
    expect(close).toHaveBeenCalled();
  });
});
