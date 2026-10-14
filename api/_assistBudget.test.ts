import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The daily AI-draft budget for non-owners (#73). The db mock keeps a real
// in-memory `gemini_assists` table and honors the upsert's `WHERE n < cap`, so
// the caps are asserted rather than stubbed.

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./_db.js', () => ({ db: () => ({ execute }) }));

const { ACCOUNT_DAILY_ASSISTS, TOTAL_DAILY_ASSISTS, claimAssist, resetAssistBudgetForTests } =
  await import('./_assistBudget.js');

let counts: Map<string, number>;
let creates: number;

beforeEach(() => {
  counts = new Map();
  creates = 0;
  resetAssistBudgetForTests();
  execute.mockImplementation((q: string | { sql: string; args: unknown[] }) => {
    if (typeof q === 'string') {
      expect(q).toMatch(/^CREATE TABLE IF NOT EXISTS gemini_assists/);
      creates += 1;
      return Promise.resolve({ rows: [] });
    }
    if (/^UPDATE gemini_assists SET n = n - 1/.test(q.sql)) {
      const [day, who] = q.args as [string, string];
      const n = counts.get(`${day}|${who}`) ?? 0;
      if (n > 0) counts.set(`${day}|${who}`, n - 1);
      return Promise.resolve({ rows: [] });
    }
    expect(q.sql).toMatch(/^INSERT INTO gemini_assists/);
    const [day, who, cap] = q.args as [string, string, number];
    const key = `${day}|${who}`;
    const n = counts.get(key);
    if (n === undefined) {
      counts.set(key, 1);
      return Promise.resolve({ rows: [{ n: 1 }] });
    }
    if (n >= cap) return Promise.resolve({ rows: [] });
    counts.set(key, n + 1);
    return Promise.resolve({ rows: [{ n: n + 1 }] });
  });
});

afterEach(() => {
  execute.mockReset();
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
    // The refused call gave its account claim back.
    expect(counts.get('2026-03-01|fresh@example.com')).toBe(0);
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
