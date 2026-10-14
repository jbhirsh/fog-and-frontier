import { db } from './_db.js';

// The Gemini assist for signed-in non-owners (#73): a paid call, so it's
// capped per account and overall per UTC day, counted in Turso so the caps
// hold across serverless instances. Owners aren't counted.
export const ACCOUNT_DAILY_ASSISTS = 5;
export const TOTAL_DAILY_ASSISTS = 30;

// The bucket for "everyone", beside the per-account ones.
const EVERYONE = '*';

let table: Promise<unknown> | null = null;

async function claim(day: string, who: string, cap: number): Promise<boolean> {
  const rs = await db().execute({
    sql: `INSERT INTO gemini_assists (day, who, n) VALUES (?, ?, 1)
          ON CONFLICT (day, who) DO UPDATE SET n = n + 1 WHERE n < ?
          RETURNING n`,
    args: [day, who, cap],
  });
  return rs.rows.length > 0;
}

/**
 * Takes one of today's assists for `email`, or says there are none left
 * (false). The account's own cap is checked first, so an account past its
 * five never touches the shared budget; if the shared budget is spent, the
 * account's claim is given back, so a refused call costs it nothing.
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
  if (!(await claim(day, email, ACCOUNT_DAILY_ASSISTS))) return false;
  if (await claim(day, EVERYONE, TOTAL_DAILY_ASSISTS)) return true;
  await db().execute({
    sql: 'UPDATE gemini_assists SET n = n - 1 WHERE day = ? AND who = ? AND n > 0',
    args: [day, email],
  });
  return false;
}

/** For tests: forget that the table was created. */
export function resetAssistBudgetForTests(): void {
  table = null;
}
