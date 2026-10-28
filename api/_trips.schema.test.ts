import { beforeEach, describe, expect, it, vi } from 'vitest';

// Schema setup runs before a cold instance answers its first request, so it
// goes to Turso as one batch rather than a round trip per table.

type Stmt = string | { sql: string; args: unknown[] };

const { execute, batch } = vi.hoisted(() => ({
  execute: vi.fn<(q: Stmt) => Promise<{ rows: unknown[] }>>(),
  batch: vi.fn<(stmts: Stmt[], mode: string) => Promise<{ rows: unknown[] }[]>>(),
}));
vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));
const sqlOf = (s: Stmt) => (typeof s === 'string' ? s : s.sql);

const SENTINEL = { rows: [{ value: '1' }] };
const NO_SENTINEL = { rows: [] };

// A fresh module per test: it remembers, per instance, that it has run.
async function freshEnsure() {
  vi.resetModules();
  process.env.OWNER_EMAILS = 'owner@example.com';
  return (await import('./_trips.js')).ensureAllSchemas;
}

function answerBatch(sentinel: { rows: unknown[] }) {
  batch.mockImplementation((stmts: Stmt[]) =>
    Promise.resolve(stmts.map((_s, i) => (i === stmts.length - 1 ? sentinel : { rows: [] }))),
  );
}

beforeEach(() => {
  execute.mockReset();
  batch.mockReset();
  execute.mockResolvedValue({ rows: [] });
});

describe('ensureAllSchemas', () => {
  it('creates every table in one write batch, the backfill sentinel read last', async () => {
    answerBatch(SENTINEL);
    await (
      await freshEnsure()
    )();

    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batch.mock.calls[0] ?? [[], ''];
    expect(mode).toBe('write');
    const tables = stmts
      .map(sqlOf)
      .flatMap((sql) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1] ?? []);
    expect(tables).toEqual([
      'trips',
      'trip_activities',
      'users',
      'meta',
      'trip_members',
      'trip_invites',
      'trip_votes',
      'a',
      'c',
      'activity_reviews',
      'activity_photos',
      'suggestions',
    ]);
    expect(
      stmts.map(sqlOf).filter((sql) => sql.includes('CREATE') && sql.includes('INDEX')),
    ).toHaveLength(6);
    expect(stmts.at(-1)).toEqual({
      sql: 'SELECT value FROM meta WHERE key = ?',
      args: ['members_backfill_v1'],
    });
    // With the sentinel set, nothing else goes to the database.
    expect(execute).not.toHaveBeenCalled();
  });

  it('backfills owners and members once, on a database with no sentinel', async () => {
    answerBatch(NO_SENTINEL);
    await (
      await freshEnsure()
    )();

    const sqls = execute.mock.calls.map(([q]) => sqlOf(q));
    expect(sqls.some((sql) => sql.includes('INSERT INTO users'))).toBe(true);
    expect(execute).toHaveBeenLastCalledWith({
      sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      args: ['members_backfill_v1', '1'],
    });
  });

  it('backfills when the batch answers without the sentinel read', async () => {
    batch.mockResolvedValue([]);
    await (
      await freshEnsure()
    )();
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: ['members_backfill_v1', '1'] }),
    );
  });

  it('runs once per instance', async () => {
    answerBatch(NO_SENTINEL);
    const ensure = await freshEnsure();
    await ensure();
    const calls = execute.mock.calls.length;
    await ensure();
    expect(batch).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(calls);
  });
});
