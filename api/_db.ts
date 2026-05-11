import { createClient, type Client } from '@libsql/client';

// Central libsql client. In dev, set DEV_DB_PATH to read from a local SQLite
// snapshot of prod (see scripts/snapshot-prod-db.ts). In Vercel, the real
// Turso credentials drive the client.
//
// Files in api/ that start with `_` are not exposed as routes by Vercel.
let _client: Client | null = null;

// Guard against the incident-#25 failure mode: a misconfigured env var causes
// a Production deployment to read from the Preview DB, or vice versa. The
// integration is gone, but env vars are still hand-managed and could drift.
// Hard-fail at first DB use if VERCEL_ENV doesn't match the URL.
const EXPECTED_DB_BY_ENV: Record<string, string> = {
  production: 'database-erin-kite',
  preview: 'fog-and-frontier-preview',
};

function assertEnvMatchesUrl(url: string): void {
  const vercelEnv = process.env.VERCEL_ENV;
  if (!vercelEnv) return;
  const expected = EXPECTED_DB_BY_ENV[vercelEnv];
  if (!expected) return;
  if (!url.includes(expected)) {
    throw new Error(
      `TURSO_DATABASE_URL mismatch: VERCEL_ENV=${vercelEnv} expects "${expected}" in URL, got a different DB. ` +
        `Refusing to connect to prevent cross-environment writes.`,
    );
  }
}

export function db(): Client {
  if (_client) return _client;
  const devPath = process.env.DEV_DB_PATH;
  if (devPath) {
    _client = createClient({ url: `file:${devPath}` });
  } else {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error('TURSO_DATABASE_URL not set');
    assertEnvMatchesUrl(url);
    _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}
