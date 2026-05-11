import { createClient, type Client } from '@libsql/client';

// Central libsql client. In dev, set DEV_DB_PATH to read from a local SQLite
// snapshot of prod (see scripts/snapshot-prod-db.ts). In Vercel, the real
// Turso credentials drive the client.
//
// Files in api/ that start with `_` are not exposed as routes by Vercel.
let _client: Client | null = null;

export function db(): Client {
  if (_client) return _client;
  const devPath = process.env.DEV_DB_PATH;
  if (devPath) {
    _client = createClient({ url: `file:${devPath}` });
  } else {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error('TURSO_DATABASE_URL not set');
    _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}
