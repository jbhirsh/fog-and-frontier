import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The daily AI-draft budget for non-owners (#73). The db mock keeps a real
// in-memory `gemini_assists` table and honors the upsert's `WHERE n < cap`, so
// the caps are asserted rather than stubbed.

const { execute, batch } = vi.hoisted(() => ({ execute: vi.fn(), batch: vi.fn() }));
vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

const {
  ACCOUNT_DAILY_ASSISTS,
  TOTAL_DAILY_ASSISTS,
  claimAssist,
  releaseAssist,
  resetAssistBudgetForTests,
} = await import('./_assistBudget.js');

let counts: Map<string, number>;
let creates: number;

// One statement against the in-memory table. `previous` is the rows the
// statement before it in the batch changed, which `changes()` reads.
function runStatement(q: { sql: string; args: unknown[] }, previous: number) {
  if (/^UPDATE gemini_assists SET n = n - 1/.test(q.sql)) {
    const [day, who] = q.args as [string, string];
    const n = counts.get(`${day}|${who}`) ?? 0;
    if (n > 0) counts.set(`${day}|${who}`, n - 1);
    return { rows: [], rowsAffected: n > 0 ? 1 : 0 };
  }
  // The shared count: only when the account's was taken just before.
  if (/SELECT \?, '\*', 1 WHERE changes\(\) = 1/.test(q.sql)) {
    if (previous !== 1) return { rows: [], rowsAffected: 0 };
    const [day] = q.args as [string];
    counts.set(`${day}|*`, (counts.get(`${day}|*`) ?? 0) + 1);
    return { rows: [], rowsAffected: 1 };
  }
  // The account's count: under its own cap, while the shared one has room.
  expect(q.sql).toMatch(
    /^INSERT INTO gemini_assists \(day, who, n\)\s+SELECT \?, \?, 1 WHERE COALESCE/,
  );
  const [day, who, , total, cap] = q.args as [string, string, string, number, number];
  if ((counts.get(`${day}|*`) ?? 0) >= total) return { rows: [], rowsAffected: 0 };
  const n = counts.get(`${day}|${who}`) ?? 0;
  if (n >= cap) return { rows: [], rowsAffected: 0 };
  counts.set(`${day}|${who}`, n + 1);
  return { rows: [], rowsAffected: 1 };
}

beforeEach(() => {
  counts = new Map();
  creates = 0;
  resetAssistBudgetForTests();
  // Only the table's creation goes outside a batch.
  execute.mockImplementation((q: string) => {
    expect(q).toMatch(/^CREATE TABLE IF NOT EXISTS gemini_assists/);
    creates += 1;
    return Promise.resolve({ rows: [] });
  });
  // A batch runs its statements against the same table, in order, as one write.
  batch.mockImplementation((stmts: { sql: string; args: unknown[] }[], mode: string) => {
    expect(mode).toBe('write');
    let previous = 0;
    return Promise.resolve(
      stmts.map((stmt) => {
        const result = runStatement(stmt, previous);
        previous = result.rowsAffected;
        return result;
      }),
    );
  });
});

afterEach(() => {
  execute.mockReset();
  batch.mockReset();
});

const DAY = new Date('2026-03-01T12:00:00Z');

describe('claimAssist', () => {
  it('allows five a day per account, then refuses', async () => {
    expect(ACCOUNT_DAILY_ASSISTS).toBe(5);
    for (let i = 0; i < 5; i += 1) expect(await claimAssist('a@example.com', DAY)).toBe(true);
    expect(await claimAssist('a@example.com', DAY)).toBe(false);
    expect(counts.get('2026-03-01|a@example.com')).toBe(5);
    // Another account still has its own five.
    expect(await claimAssist('b@example.com', DAY)).toBe(true);
  });

  it('counts by UTC day, so tomorrow starts over', async () => {
    for (let i = 0; i < 5; i += 1) await claimAssist('a@example.com', DAY);
    expect(await claimAssist('a@example.com', new Date('2026-03-02T00:00:00Z'))).toBe(true);
    expect(counts.get('2026-03-02|a@example.com')).toBe(1);
  });

  it('caps everyone together at thirty a day', async () => {
    expect(TOTAL_DAILY_ASSISTS).toBe(30);
    for (let i = 0; i < 30; i += 1) {
      expect(await claimAssist(`u${Math.floor(i / 5)}@example.com`, DAY)).toBe(true);
    }
    expect(await claimAssist('fresh@example.com', DAY)).toBe(false);
    expect(counts.get('2026-03-01|*')).toBe(30);
    // The refused call wrote nothing for its account.
    expect(counts.has('2026-03-01|fresh@example.com')).toBe(false);
    expect(await claimAssist('u0@example.com', DAY)).toBe(false);
    expect(counts.get('2026-03-01|u0@example.com')).toBe(5);
  });

  it("gives back only the refused account's claim", async () => {
    for (let i = 0; i < 30; i += 1) await claimAssist(`u${Math.floor(i / 5)}@example.com`, DAY);
    await claimAssist('u0@example.com', DAY);
    await claimAssist('fresh@example.com', DAY);
    expect([...counts.entries()].filter(([k]) => k.startsWith('2026-03-01|u'))).toEqual(
      Array.from({ length: 6 }, (_, i) => [`2026-03-01|u${i}@example.com`, 5]),
    );
  });

  it('takes both counts in one write, or neither', async () => {
    expect(await claimAssist('a@example.com', DAY)).toBe(true);
    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts] = batch.mock.calls[0] as [{ sql: string }[]];
    expect(stmts).toHaveLength(2);
    // Nothing is written outside the batch but the table itself.
    expect(execute.mock.calls.every(([q]: unknown[]) => typeof q === 'string')).toBe(true);
    // Refused by its own cap: neither count moves.
    for (let i = 0; i < 4; i += 1) await claimAssist('a@example.com', DAY);
    expect(await claimAssist('a@example.com', DAY)).toBe(false);
    expect(counts.get('2026-03-01|a@example.com')).toBe(5);
    expect(counts.get('2026-03-01|*')).toBe(5);
  });

  it("an account past its own cap doesn't use up the shared one", async () => {
    for (let i = 0; i < 7; i += 1) await claimAssist('a@example.com', DAY);
    expect(counts.get('2026-03-01|*')).toBe(5);
  });

  it('creates the table once, and again after a failed create', async () => {
    await claimAssist('a@example.com', DAY);
    await claimAssist('a@example.com', DAY);
    expect(creates).toBe(1);

    resetAssistBudgetForTests();
    execute.mockImplementationOnce(() => Promise.reject(new Error('down')));
    await expect(claimAssist('a@example.com', DAY)).rejects.toThrow('down');
    await claimAssist('a@example.com', DAY);
    expect(creates).toBe(2);
  });

  it('defaults to now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-05T08:00:00Z'));
    await claimAssist('a@example.com');
    vi.useRealTimers();
    expect(counts.get('2026-04-05|a@example.com')).toBe(1);
  });
});

describe('releaseAssist', () => {
  it("gives back the account's draft and the shared one, in one write", async () => {
    await claimAssist('a@example.com', DAY);
    await claimAssist('a@example.com', DAY);
    await claimAssist('b@example.com', DAY);
    await releaseAssist('a@example.com', DAY);
    expect(counts.get('2026-03-01|a@example.com')).toBe(1);
    expect(counts.get('2026-03-01|*')).toBe(2);
    expect(counts.get('2026-03-01|b@example.com')).toBe(1);
    // Both counts in one write, not as separate ones that could leave one given back.
    const giveBacks = (batch.mock.calls as [{ sql: string }[]][]).filter(([stmts]) =>
      stmts.some((stmt) => /^UPDATE/.test(stmt.sql)),
    );
    expect(giveBacks).toHaveLength(1);
    expect(giveBacks[0]?.[0]).toHaveLength(2);
  });

  it('lets a given-back draft be claimed again, even at the cap', async () => {
    for (let i = 0; i < 5; i += 1) await claimAssist('a@example.com', DAY);
    expect(await claimAssist('a@example.com', DAY)).toBe(false);
    await releaseAssist('a@example.com', DAY);
    expect(await claimAssist('a@example.com', DAY)).toBe(true);
  });

  it('gives back on the day it is told, and never below zero', async () => {
    await claimAssist('a@example.com', DAY);
    await releaseAssist('a@example.com', new Date('2026-03-02T00:00:01Z'));
    expect(counts.get('2026-03-01|a@example.com')).toBe(1);
    await releaseAssist('a@example.com', DAY);
    await releaseAssist('a@example.com', DAY);
    expect(counts.get('2026-03-01|a@example.com')).toBe(0);
    expect(counts.get('2026-03-01|*')).toBe(0);
  });

  it('defaults to now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-05T08:00:00Z'));
    await claimAssist('a@example.com');
    await releaseAssist('a@example.com');
    vi.useRealTimers();
    expect(counts.get('2026-04-05|a@example.com')).toBe(0);
  });
});
