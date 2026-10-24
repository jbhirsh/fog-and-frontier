import { db } from './_db.js';

// The Gemini assist for signed-in non-owners (#73): a paid call, so it's
// capped per account and overall per UTC day, counted in Turso so the caps
// hold across serverless instances. Owners aren't counted.
export const ACCOUNT_DAILY_ASSISTS = 5;
export const TOTAL_DAILY_ASSISTS = 30;

// The bucket for "everyone", beside the per-account ones.
const EVERYONE = '*';

let table: Promise<unknown> | null = null;

// While the shared bucket still has room (it may have no row yet).
const SHARED_HAS_ROOM = `COALESCE((SELECT n FROM gemini_assists WHERE day = ? AND who = '${EVERYONE}'), 0) < ?`;

/**
 * Takes one of today's assists for `email`, or says there are none left
 * (false). Both counts move in one write, or neither does: the account's is
 * counted only while it's under its own cap and the shared budget has room,
 * and the shared one only if the account's was (`changes()` reads the
 * statement before it). So a refused call costs nothing, and an account past
 * its five never touches the shared budget.
 */
export async function claimAssist(email: string, now = new Date()): Promise<boolean> {
  table ??= db()
    .execute(
      'CREATE TABLE IF NOT EXISTS gemini_assists (day TEXT NOT NULL, who TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, who))',
    )
    .catch((err: unknown) => {
      table = null;
      throw err;
    });
  await table;
  const day = now.toISOString().slice(0, 10);
  const [account] = await db().batch(
    [
      {
        sql: `INSERT INTO gemini_assists (day, who, n)
              SELECT ?, ?, 1 WHERE ${SHARED_HAS_ROOM}
              ON CONFLICT (day, who) DO UPDATE SET n = n + 1 WHERE n < ? AND ${SHARED_HAS_ROOM}`,
        args: [
          day,
          email,
          day,
          TOTAL_DAILY_ASSISTS,
          ACCOUNT_DAILY_ASSISTS,
          day,
          TOTAL_DAILY_ASSISTS,
        ],
      },
      {
        sql: `INSERT INTO gemini_assists (day, who, n)
              SELECT ?, '${EVERYONE}', 1 WHERE changes() = 1
              ON CONFLICT (day, who) DO UPDATE SET n = n + 1`,
        args: [day],
      },
    ],
    'write',
  );
  return account?.rowsAffected === 1;
}

/**
 * Gives back an assist that `claimAssist` took on `now`, the account's and the
 * shared one together, for a call that never got an answer from Gemini (the
 * request failed or was refused), so an outage doesn't spend the day's drafts.
 * A call Gemini answered, however unusable, was billed and stays counted.
 */
export async function releaseAssist(email: string, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const sql = 'UPDATE gemini_assists SET n = n - 1 WHERE day = ? AND who = ? AND n > 0';
  await db().batch(
    [
      { sql, args: [day, email] },
      { sql, args: [day, EVERYONE] },
    ],
    'write',
  );
}

/** For tests: forget that the table was created. */
export function resetAssistBudgetForTests(): void {
  table = null;
}
