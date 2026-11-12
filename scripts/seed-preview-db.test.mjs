import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile, main } from './seed-preview-db.mjs';

const question = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const createInterface = vi.hoisted(() => vi.fn(() => ({ question, close })));
vi.mock('node:readline/promises', () => ({ createInterface }));

/** Fake libSQL clients, by URL: production answers SELECTs from `tables`. */
function fakeTurso(tables) {
  const executed = new Map();
  const connect = vi.fn(({ url }) => {
    const log = [];
    executed.set(url, log);
    return {
      execute: vi.fn(async (stmt) => {
        log.push(stmt);
        const from = typeof stmt === 'string' ? stmt.match(/ FROM (\w+)/) : null;
        return { rows: from ? (tables[from[1]] ?? []) : [] };
      }),
    };
  });
  return { connect, executed };
}

const PROD = 'libsql://prod.turso.io';
const PREVIEW = 'libsql://preview.turso.io';
let cwd;
let error;
let log;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'seed-'));
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function envFiles(prod = PROD, preview = PREVIEW) {
  writeFileSync(join(cwd, '.env.prod'), `TURSO_DATABASE_URL="${prod}"\nTURSO_AUTH_TOKEN="p"\n`);
  writeFileSync(
    join(cwd, '.env.preview'),
    `TURSO_DATABASE_URL="${preview}"\nTURSO_AUTH_TOKEN="v"\n`,
  );
}

const tables = {
  a: [{ id: 'muir', j: '{}', t: 2n }],
  c: [{ id: 'muir', v: 1n }],
};

describe('loadEnvFile', () => {
  it("reads a vercel env pull file's variables, quoted or not", () => {
    writeFileSync(join(cwd, '.env.x'), '# a comment\nA="1"\nB=two\nlower=no\n');
    expect(loadEnvFile(cwd, '.env.x')).toEqual({ A: '1', B: 'two' });
  });

  it("says how to make a file that isn't there", () => {
    expect(loadEnvFile(cwd, '.env.prod')).toBeNull();
    expect(error).toHaveBeenCalledWith(
      'Missing .env.prod. Run: vercel env pull .env.prod --environment=prod',
    );
  });
});

describe('main', () => {
  it("upserts production's rows into preview once told yes", async () => {
    envFiles();
    const turso = fakeTurso(tables);
    expect(await main([], { cwd, connect: turso.connect, ask: async () => ' Y ' })).toBe(0);
    expect(turso.connect.mock.calls.map(([c]) => c)).toEqual([
      { url: PROD, authToken: 'p' },
      { url: PREVIEW, authToken: 'v' },
    ]);
    expect(turso.executed.get(PREVIEW)).toEqual([
      'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
      {
        sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
        args: ['muir', '{}', 2],
      },
      {
        sql: 'INSERT INTO c (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v',
        args: ['muir', 1],
      },
    ]);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      `Reading from prod:   ${PROD}`,
      `Writing to preview:  ${PREVIEW}`,
      'Prod has 1 activities and 1 completed entries.',
      'Wrote 1 activities and 1 completed entries to preview.',
    ]);
  });

  it('writes nothing unless told yes, asking on the terminal by default', async () => {
    envFiles();
    const turso = fakeTurso(tables);
    question.mockResolvedValueOnce('n');
    expect(await main([], { cwd, connect: turso.connect })).toBe(0);
    expect(question).toHaveBeenCalledWith('Proceed with overwriting preview? [y/N] ');
    expect(close).toHaveBeenCalled();
    expect(createInterface).toHaveBeenCalledWith({ input: process.stdin, output: process.stdout });
    expect(turso.executed.get(PREVIEW)).toEqual([]);
    expect(log).toHaveBeenLastCalledWith('Aborted.');
  });

  it('stops with 2 when an env file or a variable is missing', async () => {
    const turso = fakeTurso(tables);
    expect(await main([], { cwd, connect: turso.connect, ask: vi.fn() })).toBe(2);
    writeFileSync(join(cwd, '.env.prod'), 'TURSO_DATABASE_URL="x"\n');
    expect(await main([], { cwd, connect: turso.connect, ask: vi.fn() })).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Missing .env.preview.'));
    writeFileSync(join(cwd, '.env.preview'), 'TURSO_DATABASE_URL="y"\nTURSO_AUTH_TOKEN="v"\n');
    expect(await main([], { cwd, connect: turso.connect, ask: vi.fn() })).toBe(2);
    expect(error).toHaveBeenCalledWith('Missing prod TURSO_AUTH_TOKEN.');
    expect(turso.connect).not.toHaveBeenCalled();
  });

  it('stops with 2 when preview and production share a database', async () => {
    envFiles(PROD, PROD);
    const turso = fakeTurso(tables);
    expect(await main([], { cwd, connect: turso.connect, ask: vi.fn() })).toBe(2);
    expect(error.mock.calls.map((c) => c[0])).toEqual([
      'PROD and PREVIEW TURSO_DATABASE_URL are identical — they already share a database, no seed needed.',
      `URL: ${PROD}`,
    ]);
    expect(turso.connect).not.toHaveBeenCalled();
  });

  it('stops with 1 when production has no activities', async () => {
    envFiles();
    const ask = vi.fn();
    expect(await main([], { cwd, connect: fakeTurso({}).connect, ask })).toBe(1);
    expect(ask).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Prod has no activities — nothing to seed. Aborting.');
  });
});
