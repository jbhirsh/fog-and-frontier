import type { Client, InValue } from '@libsql/client';
import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from 'kysely';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// A Kysely dialect over the app's own libsql client (`db()` in _db.ts), for
// Better Auth (_betterAuth.ts), which reads and writes its tables through
// Kysely. @libsql/kysely-libsql does the same but bundles a second, older
// libsql client into the function; this is the part of it we use. Better
// Auth is told not to use transactions (`transaction: false`), so none are
// offered: a write that needs two statements together is the API's own,
// through db().batch.

class LibsqlConnection implements DatabaseConnection {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const rs = await this.client.execute({
      sql: query.sql,
      args: query.parameters as InValue[],
    });
    return {
      rows: rs.rows as R[],
      numAffectedRows: BigInt(rs.rowsAffected),
      insertId: rs.lastInsertRowid,
    };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('libsql dialect: streaming is not supported');
  }
}

const noTransactions = (): Promise<void> =>
  Promise.reject(new Error('libsql dialect: transactions are not supported'));

class LibsqlDriver implements Driver {
  private readonly client: () => Client;

  constructor(client: () => Client) {
    this.client = client;
  }

  async init(): Promise<void> {}

  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(new LibsqlConnection(this.client()));
  }

  beginTransaction = noTransactions;
  commitTransaction = noTransactions;
  rollbackTransaction = noTransactions;

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

/** A Kysely dialect that runs every query on the client `client()` returns. */
export function libsqlDialect(client: () => Client): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new LibsqlDriver(client),
    createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  };
}
