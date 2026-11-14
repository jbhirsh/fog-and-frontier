import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// db() picks its connection from the environment and refuses one whose URL
// names the other deployment's database (incident #25). The libSQL client is
// mocked: no real database. Each test loads a fresh module, as the client is
// cached once per instance.

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@libsql/client', () => ({ createClient }));

const ENV_KEYS = ['DEV_DB_PATH', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VERCEL_ENV'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function freshDb() {
  vi.resetModules();
  return (await import('./_db.js')).db;
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  createClient.mockImplementation((config: unknown) => ({ config }));
});

afterEach(() => {
  createClient.mockReset();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const PROD_URL = 'libsql://database-erin-kite-x.turso.io';
const PREVIEW_URL = 'libsql://fog-and-frontier-preview-x.turso.io';

describe('db', () => {
  it('reads a local snapshot when DEV_DB_PATH is set, ignoring Turso', async () => {
    process.env.DEV_DB_PATH = '/tmp/snap.db';
    process.env.TURSO_DATABASE_URL = PREVIEW_URL;
    process.env.VERCEL_ENV = 'production';
    const db = await freshDb();
    expect(db()).toEqual({ config: { url: 'file:/tmp/snap.db' } });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('connects to Turso with its token', async () => {
    process.env.TURSO_DATABASE_URL = PROD_URL;
    process.env.TURSO_AUTH_TOKEN = 'tok';
    const db = await freshDb();
    expect(db()).toEqual({ config: { url: PROD_URL, authToken: 'tok' } });
  });

  it('creates the client once and reuses it', async () => {
    process.env.TURSO_DATABASE_URL = PROD_URL;
    const db = await freshDb();
    const first = db();
    expect(db()).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('throws without a database URL, connecting nothing', async () => {
    const db = await freshDb();
    expect(() => db()).toThrow('TURSO_DATABASE_URL not set');
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['production', PROD_URL],
    ['preview', PREVIEW_URL],
    // An environment with no expected database, or none at all, is not checked.
    ['development', PREVIEW_URL],
    [undefined, PREVIEW_URL],
  ])('connects when VERCEL_ENV=%s and the URL is %s', async (env, url) => {
    if (env !== undefined) process.env.VERCEL_ENV = env;
    process.env.TURSO_DATABASE_URL = url;
    const db = await freshDb();
    expect(db()).toEqual({ config: { url, authToken: undefined } });
  });

  it.each([
    ['production', PREVIEW_URL, 'database-erin-kite'],
    ['preview', PROD_URL, 'fog-and-frontier-preview'],
  ])('refuses VERCEL_ENV=%s with the other database', async (env, url, expected) => {
    process.env.VERCEL_ENV = env;
    process.env.TURSO_DATABASE_URL = url;
    const db = await freshDb();
    expect(() => db()).toThrow(
      `TURSO_DATABASE_URL mismatch: VERCEL_ENV=${env} expects "${expected}" in URL, got a different DB. ` +
        'Refusing to connect to prevent cross-environment writes.',
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});
