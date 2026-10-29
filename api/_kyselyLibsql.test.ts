import { describe, expect, it, vi } from 'vitest';
import { Kysely, sql } from 'kysely';
import type { Client } from '@libsql/client';
import { libsqlDialect } from './_kyselyLibsql';

// Better Auth's queries go through this dialect to the app's libsql client:
// what Kysely compiles must reach client.execute as SQL and arguments, and
// what the client answers must come back as Kysely's result.

type Row = { id: string; email: string };
type Db = { auth_user: Row };

function fakeClient(answer: { rows?: unknown[]; rowsAffected?: number; lastInsertRowid?: bigint }) {
  const execute = vi.fn(() =>
    Promise.resolve({ rows: [], rowsAffected: 0, lastInsertRowid: undefined, ...answer }),
  );
  return { client: { execute } as unknown as Client, execute };
}

describe('libsqlDialect', () => {
  it('runs a compiled select on the client and returns its rows', async () => {
    const row = { id: 'u1', email: 'a@example.com' };
    const { client, execute } = fakeClient({ rows: [row] });
    const db = new Kysely<Db>({ dialect: libsqlDialect(() => client) });
    const rows = await db
      .selectFrom('auth_user')
      .selectAll()
      .where('email', '=', 'a@example.com')
      .execute();
    expect(rows).toEqual([row]);
    expect(execute).toHaveBeenCalledWith({
      sql: 'select * from "auth_user" where "email" = ?',
      args: ['a@example.com'],
    });
  });

  it('reports how many rows a write changed, and the row it inserted', async () => {
    const { client } = fakeClient({ rowsAffected: 2, lastInsertRowid: 7n });
    const db = new Kysely<Db>({ dialect: libsqlDialect(() => client) });
    const result = await db
      .updateTable('auth_user')
      .set({ email: 'b@example.com' })
      .executeTakeFirst();
    expect(result.numUpdatedRows).toBe(2n);
    const inserted = await db
      .insertInto('auth_user')
      .values({ id: 'u2', email: 'c@example.com' })
      .executeTakeFirst();
    expect(inserted.insertId).toBe(7n);
  });

  it('asks for the client on each connection, so it uses whatever db() is then', async () => {
    const first = fakeClient({});
    const second = fakeClient({});
    const clients = [first.client, second.client];
    const db = new Kysely<Db>({ dialect: libsqlDialect(() => clients.shift() ?? first.client) });
    await sql`select 1`.execute(db);
    await sql`select 2`.execute(db);
    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
  });

  it('offers no transactions (Better Auth is told not to use them)', async () => {
    const { client } = fakeClient({});
    const db = new Kysely<Db>({ dialect: libsqlDialect(() => client) });
    await expect(db.transaction().execute(() => Promise.resolve())).rejects.toThrow(
      'transactions are not supported',
    );
  });

  it('offers no streaming', async () => {
    const { client } = fakeClient({});
    const db = new Kysely<Db>({ dialect: libsqlDialect(() => client) });
    const stream = db.selectFrom('auth_user').selectAll().stream();
    await expect(stream.next()).rejects.toThrow('streaming is not supported');
  });

  it('reads the schema through the client, as Kysely’s introspection asks', async () => {
    const { client, execute } = fakeClient({});
    const db = new Kysely<Db>({ dialect: libsqlDialect(() => client) });
    await expect(db.introspection.getTables()).resolves.toEqual([]);
    expect(JSON.stringify(execute.mock.calls)).toContain('sqlite_master');
    await expect(db.destroy()).resolves.toBeUndefined();
  });
});
