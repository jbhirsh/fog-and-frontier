import { db } from './_db.js';

// Daily per-key budget counter for Gemini-calling endpoints (issue #23).
//
// Each call to `enforceDailyBudget(key)` atomically upserts today's row and
// returns the new count via SQLite's RETURNING clause. If the count exceeds
// the configured daily limit, throws BudgetExceededError so the calling
// handler can return 429 without spending a Gemini request.
//
// Day boundaries are UTC YYYY-MM-DD. The choice is deliberate: it's stable
// regardless of which Vercel region or Fluid Compute instance serves the
// request, and matches Google Cloud billing's UTC reset semantics. Owners
// see a single global counter rather than per-region drift.
//
// Files in api/ that start with `_` are not exposed as routes by Vercel.

export type BudgetKey = 'discover' | 'generate';

const DEFAULT_LIMITS: Record<BudgetKey, number> = {
  discover: 50,
  generate: 200,
};

const ENV_VAR_BY_KEY: Record<BudgetKey, string> = {
  discover: 'GEMINI_DISCOVER_DAILY_LIMIT',
  generate: 'GEMINI_GENERATE_DAILY_LIMIT',
};

export class BudgetExceededError extends Error {
  readonly key: BudgetKey;
  readonly limit: number;
  readonly used: number;
  readonly resetsAt: string;

  constructor(key: BudgetKey, limit: number, used: number, resetsAt: string) {
    super(`daily budget exceeded for ${key} (${used}/${limit})`);
    this.name = 'BudgetExceededError';
    this.key = key;
    this.limit = limit;
    this.used = used;
    this.resetsAt = resetsAt;
  }
}

function todayUTC(): string {
  // ISO date in UTC, e.g. "2026-05-15". slice(0,10) on toISOString is the
  // standard one-liner; it never depends on the host TZ.
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightISO(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return next.toISOString();
}

function limitFor(key: BudgetKey): number {
  const raw = process.env[ENV_VAR_BY_KEY[key]];
  if (raw === undefined || raw === '') return DEFAULT_LIMITS[key];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMITS[key];
  return Math.floor(n);
}

let schemaReady = false;
async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await db().execute(
    'CREATE TABLE IF NOT EXISTS gemini_usage (key TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, day))',
  );
  schemaReady = true;
}

// Exported only so tests can reset module-level state between cases.
export function _resetSchemaCacheForTests(): void {
  schemaReady = false;
}

/**
 * Atomically increment today's counter for `key`. Throws BudgetExceededError
 * if the post-increment count is above the configured limit.
 *
 * The increment happens before the limit check by design: we want over-limit
 * attempts to *also* be visible in the table, so the log query "how much did
 * we try to spend today" tells the real story.
 */
export async function enforceDailyBudget(key: BudgetKey): Promise<number> {
  await ensureSchema();
  const today = todayUTC();
  const limit = limitFor(key);

  const rs = await db().execute({
    sql:
      'INSERT INTO gemini_usage (key, day, count) VALUES (?, ?, 1) ' +
      'ON CONFLICT(key, day) DO UPDATE SET count = count + 1 RETURNING count',
    args: [key, today],
  });

  const row = rs.rows[0];
  if (!row) {
    throw new Error('gemini_usage RETURNING did not produce a numeric count');
  }
  const raw = row.count;
  let count: number;
  if (typeof raw === 'number') count = raw;
  else if (typeof raw === 'bigint') count = Number(raw);
  else count = Number(raw);
  if (!Number.isFinite(count)) {
    throw new Error('gemini_usage RETURNING did not produce a numeric count');
  }

  if (count > limit) {
    throw new BudgetExceededError(key, limit, count, nextUtcMidnightISO());
  }

  // Lightweight observability hook (#20). One log per Gemini call is cheap
  // and makes "today's usage" answerable from Vercel logs alone.
  console.log(
    `[gemini-budget] key=${key} count=${count} limit=${limit} day=${today}`,
  );

  return count;
}
