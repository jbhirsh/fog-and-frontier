import { beforeEach, describe, expect, it, vi } from 'vitest';

// The sign-in setup per deployment: what each one is bound to (its origin,
// for cookies and passkeys), who it trusts, what it refuses (on production,
// the OAuth proxy's completion and Google ID tokens: a preview holds the
// proxy secret and is handed ID tokens), which secrets each needs, and what
// a sign-in writes. Better Auth itself is the library's
// to test; this is our configuration of it.

import { betterAuth } from 'better-auth';
import { getAuthTables } from 'better-auth/db';
import { SCHEMA } from './_trips';

const { execute, syncUserRow, logServerError } = vi.hoisted(() => ({
  execute: vi.fn(),
  syncUserRow: vi.fn(),
  logServerError: vi.fn(),
}));
vi.mock('./_db.js', () => ({ db: () => ({ execute }) }));
vi.mock('./_auth.js', () => ({ syncUserRow }));
vi.mock('./_log.js', () => ({ logServerError }));

const { PRODUCTION_ORIGIN, authOptions, authOrigin, isProduction, refusedRoute, trustedOrigins } =
  await import('./_betterAuth.js');

const SECRETS = {
  BETTER_AUTH_SECRET: 's'.repeat(32),
  OAUTH_PROXY_SECRET: 'p'.repeat(32),
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};
const PRODUCTION = { VERCEL_ENV: 'production', ...SECRETS };
const PREVIEW = {
  VERCEL_ENV: 'preview',
  VERCEL_BRANCH_URL: 'fog-and-frontier-git-claude-x-jbhirshs-projects.vercel.app',
  ...SECRETS,
};

type Plugin = { id: string; options?: Record<string, unknown> };
const plugin = (env: Record<string, string>, id: string) =>
  (authOptions(env).plugins as Plugin[]).find((p) => p.id === id);

beforeEach(() => {
  execute.mockReset();
  syncUserRow.mockReset();
  logServerError.mockReset();
});

describe('authOrigin', () => {
  it('is the real site on production', () => {
    expect(authOrigin(PRODUCTION)).toBe(PRODUCTION_ORIGIN);
  });

  it('is the branch’s address on a preview, the same across its pushes', () => {
    expect(authOrigin(PREVIEW)).toBe(`https://${PREVIEW.VERCEL_BRANCH_URL}`);
  });

  it('is localhost on a laptop', () => {
    expect(authOrigin({})).toBe('http://localhost:3000');
    expect(authOrigin({ VERCEL_ENV: 'preview' })).toBe('http://localhost:3000');
  });

  it('takes BETTER_AUTH_URL first, without a trailing slash', () => {
    expect(authOrigin({ ...PRODUCTION, BETTER_AUTH_URL: 'http://localhost:5173//' })).toBe(
      'http://localhost:5173',
    );
  });
});

describe('isProduction', () => {
  it('is only the production deployment', () => {
    expect(isProduction(PRODUCTION)).toBe(true);
    expect(isProduction(PREVIEW)).toBe(false);
    expect(isProduction({})).toBe(false);
  });
});

describe('trustedOrigins', () => {
  it('is production alone on production', () => {
    expect(trustedOrigins(PRODUCTION)).toEqual([PRODUCTION_ORIGIN]);
  });

  it('is a preview’s branch and deployment addresses on a preview, and no wildcard', () => {
    expect(
      trustedOrigins({
        ...PREVIEW,
        VERCEL_URL: 'fog-and-frontier-abc123-jbhirshs-projects.vercel.app',
      }),
    ).toEqual([
      `https://${PREVIEW.VERCEL_BRANCH_URL}`,
      'https://fog-and-frontier-abc123-jbhirshs-projects.vercel.app',
    ]);
    expect(trustedOrigins(PREVIEW)).toEqual([`https://${PREVIEW.VERCEL_BRANCH_URL}`]);
  });

  it('is localhost and the Vite dev server on a laptop', () => {
    expect(trustedOrigins({})).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });
});

describe('refusedRoute', () => {
  it.each(['/callback/:id/oauth-proxy', '/oauth-proxy-callback'])(
    'refuses %s on production only',
    (path) => {
      expect(refusedRoute(path, PRODUCTION)).toBe(true);
      expect(refusedRoute(path, PREVIEW)).toBe(false);
    },
  );

  it('refuses renaming an account everywhere: its name is Google’s', () => {
    expect(refusedRoute('/update-user', PRODUCTION)).toBe(true);
    expect(refusedRoute('/update-user', PREVIEW)).toBe(true);
  });

  it.each(['/callback/:id', '/sign-in/social', '/get-session', undefined])(
    'leaves %s alone',
    (path) => {
      expect(refusedRoute(path, PRODUCTION)).toBe(false);
    },
  );
});

// The real site's Better Auth, answering requests: what production refuses
// it refuses however the path is spelled, since the hook sees the route.
describe('production, answering', () => {
  const site = () => betterAuth(authOptions(PRODUCTION));
  const call = (path: string, init?: RequestInit) =>
    site().handler(
      new Request(`${PRODUCTION_ORIGIN}/api/auth${path}`, {
        ...init,
        headers: { origin: PRODUCTION_ORIGIN, 'content-type': 'application/json' },
      }),
    );

  it.each([
    '/callback/google/oauth-proxy?callbackURL=x',
    '/callback/anything/oauth-proxy?callbackURL=x',
    '/oauth-proxy-callback?callbackURL=x',
  ])('refuses %s', async (path) => {
    expect((await call(path)).status).toBe(404);
  });

  it('refuses renaming an account', async () => {
    const res = await call('/update-user', { method: 'POST', body: '{"name":"Jess"}' });
    expect(res.status).toBe(404);
  });

  it('takes no Google ID token, which a preview is handed', async () => {
    const res = await call('/sign-in/social', {
      method: 'POST',
      body: JSON.stringify({ provider: 'google', idToken: { token: 'a.b.c' } }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code?: string }).code).toBe('ID_TOKEN_NOT_SUPPORTED');
  });
});

describe('authOptions', () => {
  it('binds the deployment to its origin, passkeys included', () => {
    const options = authOptions(PREVIEW);
    expect(options.baseURL).toBe(`https://${PREVIEW.VERCEL_BRANCH_URL}`);
    expect(plugin(PREVIEW, 'passkey')?.options).toMatchObject({
      rpID: PREVIEW.VERCEL_BRANCH_URL,
      origin: `https://${PREVIEW.VERCEL_BRANCH_URL}`,
    });
  });

  it('sends every Google sign-in back through production', () => {
    expect(plugin(PREVIEW, 'oauth-proxy')?.options).toMatchObject({
      productionURL: PRODUCTION_ORIGIN,
      secret: SECRETS.OAUTH_PROXY_SECRET,
    });
  });

  it.each(['BETTER_AUTH_SECRET', 'OAUTH_PROXY_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])(
    'needs %s on production',
    (name) => {
      expect(() => authOptions({ ...PRODUCTION, [name]: '' })).toThrow(`${name} not set`);
    },
  );

  it('lets a preview do without the Google secret, which only production uses', () => {
    const preview = { ...PREVIEW, GOOGLE_CLIENT_SECRET: undefined };
    expect(authOptions(preview).socialProviders.google.clientSecret).toBe(
      'exchanged-by-production',
    );
    expect(authOptions(PREVIEW).socialProviders.google.clientSecret).toBe('google-secret');
  });

  it('takes the account’s name from Google at each sign-in, and no ID token', () => {
    expect(authOptions(PRODUCTION).socialProviders.google).toMatchObject({
      disableIdTokenSignIn: true,
      overrideUserInfoOnSignIn: true,
    });
  });

  it('names an account by its first name, for attributions', () => {
    const { mapProfileToUser } = authOptions(PRODUCTION).socialProviders.google;
    expect(mapProfileToUser({ given_name: ' Tarun ', name: 'Tarun Patel' })).toEqual({
      name: 'Tarun',
    });
    expect(mapProfileToUser({ name: 'Jess' })).toEqual({ name: 'Jess' });
    expect(mapProfileToUser({})).toEqual({ name: '' });
    expect(mapProfileToUser({ given_name: 'x'.repeat(80) }).name).toHaveLength(50);
  });

  it('brings the account’s users row up to date at each sign-in', async () => {
    execute.mockResolvedValue({ rows: [{ email: 'Owner@Example.com', name: 'Jess' }] });
    await authOptions(PRODUCTION).databaseHooks.session.create.after({ userId: 'u1' });
    expect(execute).toHaveBeenCalledWith({
      sql: 'SELECT email, name FROM auth_user WHERE id = ?',
      args: ['u1'],
    });
    expect(syncUserRow).toHaveBeenCalledWith('Owner@Example.com', 'Jess');
  });

  it('writes nothing for a session whose account is gone', async () => {
    execute.mockResolvedValue({ rows: [] });
    await authOptions(PRODUCTION).databaseHooks.session.create.after({ userId: 'gone' });
    expect(syncUserRow).not.toHaveBeenCalled();
  });

  it('logs a users row that won’t write, rather than failing the sign-in', async () => {
    execute.mockResolvedValue({ rows: [{ email: 'a@example.com', name: 'Sam' }] });
    syncUserRow.mockRejectedValue(new Error('turso down'));
    await expect(
      authOptions(PRODUCTION).databaseHooks.session.create.after({ userId: 'u1' }),
    ).resolves.toBeUndefined();
    expect(logServerError).toHaveBeenCalledWith(expect.any(Error), {
      route: '/api/auth',
      detail: 'users row sync failed',
    });
  });

  it('passes no name when the account has none', async () => {
    execute.mockResolvedValue({ rows: [{ email: 'a@example.com', name: null }] });
    await authOptions(PRODUCTION).databaseHooks.session.create.after({ userId: 'u1' });
    expect(syncUserRow).toHaveBeenCalledWith('a@example.com', null);
  });
});

// Better Auth doesn't inspect its tables at startup (validateSchema: false):
// they're SCHEMA's, generated by its migration code. This is the check
// instead, run on every change: each table and column Better Auth writes,
// with this configuration and its plugins, has to be in SCHEMA, so an upgrade
// that adds one fails here, not at someone's sign-in.
describe('the auth tables in SCHEMA', () => {
  const created = new Map(
    SCHEMA.flatMap((sql) => {
      const m = /^CREATE TABLE IF NOT EXISTS "(\w+)" \((.*)\)$/s.exec(sql);
      if (!m) return [];
      const columns = [...m[2].matchAll(/"(\w+)" (?:text|integer|date)/g)].map((c) => c[1]);
      return [[m[1], new Set(columns)] as const];
    }),
  );

  const tables = Object.values(getAuthTables(authOptions(PRODUCTION)));

  it('are the tables Better Auth writes', () => {
    expect(tables.map((t) => t.modelName).sort()).toEqual([
      'auth_account',
      'auth_passkey',
      'auth_session',
      'auth_user',
      'auth_verification',
    ]);
  });

  it.each(tables.map((t) => [t.modelName, t] as const))(
    '%s has every column it writes',
    (name, table) => {
      const columns = created.get(name);
      expect(columns, `no CREATE TABLE for ${name} in SCHEMA`).toBeDefined();
      const expected = [
        'id',
        ...Object.entries(table.fields).map(([key, f]) => f.fieldName ?? key),
      ];
      expect(expected.filter((c) => !columns?.has(c))).toEqual([]);
    },
  );
});
