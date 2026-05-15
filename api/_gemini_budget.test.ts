import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('./_db.js', () => ({
  db: () => ({ execute }),
}));

const {
  BudgetExceededError,
  enforceDailyBudget,
  _resetSchemaCacheForTests,
} = await import('./_gemini_budget.js');

type ExecuteArg = { sql: string; args: unknown[] } | string;

function isObjectArg(
  a: ExecuteArg,
): a is { sql: string; args: unknown[] } {
  return typeof a === 'object';
}

function mockCounterResponses(counts: number[]): void {
  // First call is the CREATE TABLE (string SQL), the rest are increments.
  execute.mockImplementation((arg: ExecuteArg) => {
    if (!isObjectArg(arg)) return Promise.resolve({ rows: [] });
    const next = counts.shift();
    if (next === undefined) {
      throw new Error('mockCounterResponses ran out of counts');
    }
    return Promise.resolve({ rows: [{ count: next }] });
  });
}

describe('api/_gemini_budget', () => {
  beforeEach(() => {
    _resetSchemaCacheForTests();
    execute.mockReset();
    delete process.env.GEMINI_DISCOVER_DAILY_LIMIT;
    delete process.env.GEMINI_GENERATE_DAILY_LIMIT;
  });

  afterEach(() => {
    delete process.env.GEMINI_DISCOVER_DAILY_LIMIT;
    delete process.env.GEMINI_GENERATE_DAILY_LIMIT;
  });

  it('creates the gemini_usage table on first use (then memoises)', async () => {
    mockCounterResponses([1, 2]);
    await enforceDailyBudget('discover');
    await enforceDailyBudget('discover');

    const creates = execute.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('CREATE TABLE'),
    );
    expect(creates).toHaveLength(1);
    expect(creates[0][0]).toContain('gemini_usage');
    expect(creates[0][0]).toContain('PRIMARY KEY (key, day)');
  });

  it('issues an atomic upsert+increment with RETURNING count and a UTC date', async () => {
    mockCounterResponses([7]);
    await enforceDailyBudget('discover');

    const upsert = execute.mock.calls.find(
      (c) => typeof c[0] === 'object' && c[0] !== null,
    );
    expect(upsert).toBeDefined();
    const arg = upsert![0] as { sql: string; args: unknown[] };
    expect(arg.sql).toContain('INSERT INTO gemini_usage');
    expect(arg.sql).toContain('ON CONFLICT(key, day)');
    expect(arg.sql).toContain('count = count + 1');
    expect(arg.sql).toContain('RETURNING count');
    expect(arg.args[0]).toBe('discover');
    expect(arg.args[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // ISO date prefix must equal toISOString() prefix (UTC).
    expect(arg.args[1]).toBe(new Date().toISOString().slice(0, 10));
  });

  it('returns the new count for under-budget calls', async () => {
    mockCounterResponses([1, 2, 3]);
    expect(await enforceDailyBudget('discover')).toBe(1);
    expect(await enforceDailyBudget('discover')).toBe(2);
    expect(await enforceDailyBudget('discover')).toBe(3);
  });

  it('throws BudgetExceededError when count exceeds the discover default (50)', async () => {
    mockCounterResponses([51]);
    await expect(enforceDailyBudget('discover')).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('does NOT throw at the limit (count === limit is still allowed)', async () => {
    mockCounterResponses([50]);
    await expect(enforceDailyBudget('discover')).resolves.toBe(50);
  });

  it('uses the generate default of 200 when env var unset', async () => {
    mockCounterResponses([200, 201]);
    await expect(enforceDailyBudget('generate')).resolves.toBe(200);
    _resetSchemaCacheForTests();
    execute.mockReset();
    mockCounterResponses([201]);
    await expect(enforceDailyBudget('generate')).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('respects GEMINI_DISCOVER_DAILY_LIMIT env override', async () => {
    process.env.GEMINI_DISCOVER_DAILY_LIMIT = '3';
    mockCounterResponses([4]);
    await expect(enforceDailyBudget('discover')).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('respects GEMINI_GENERATE_DAILY_LIMIT env override', async () => {
    process.env.GEMINI_GENERATE_DAILY_LIMIT = '1';
    mockCounterResponses([2]);
    await expect(enforceDailyBudget('generate')).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('ignores invalid limit env values and falls back to defaults', async () => {
    process.env.GEMINI_DISCOVER_DAILY_LIMIT = 'not-a-number';
    mockCounterResponses([50]);
    // Default is 50; 50 <= 50, so no throw.
    await expect(enforceDailyBudget('discover')).resolves.toBe(50);
  });

  it('ignores non-positive limit env values', async () => {
    process.env.GEMINI_DISCOVER_DAILY_LIMIT = '0';
    mockCounterResponses([50]);
    await expect(enforceDailyBudget('discover')).resolves.toBe(50);
  });

  it('BudgetExceededError exposes key, limit, used, and a future ISO resetsAt', async () => {
    process.env.GEMINI_DISCOVER_DAILY_LIMIT = '2';
    mockCounterResponses([3]);
    const before = Date.now();
    try {
      await enforceDailyBudget('discover');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      if (!(err instanceof BudgetExceededError)) throw err;
      expect(err.key).toBe('discover');
      expect(err.limit).toBe(2);
      expect(err.used).toBe(3);
      expect(err.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
      expect(Date.parse(err.resetsAt)).toBeGreaterThan(before);
    }
  });

  it('handles bigint counts returned by libsql', async () => {
    execute.mockImplementation((arg: ExecuteArg) => {
      if (!isObjectArg(arg)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ count: BigInt(5) }] });
    });
    await expect(enforceDailyBudget('discover')).resolves.toBe(5);
  });

  it('throws a clear error if RETURNING produces no row', async () => {
    execute.mockImplementation((arg: ExecuteArg) => {
      if (!isObjectArg(arg)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    await expect(enforceDailyBudget('discover')).rejects.toThrow(
      /numeric count/,
    );
  });
});
