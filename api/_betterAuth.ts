import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { oAuthProxy } from 'better-auth/plugins/oauth-proxy';
import { passkey } from '@better-auth/passkey';
import { db } from './_db.js';
import { libsqlDialect } from './_kyselyLibsql.js';
import { syncUserRow } from './_auth.js';
import { logServerError } from './_log.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// Sign-in (Better Auth): Google, and passkeys once signed in. The session is
// an HttpOnly cookie on this deployment's own origin, so every request
// carries it and nothing waits on a sign-in service before the app's first
// read. Its tables (auth_user, auth_session, auth_account, auth_verification,
// auth_passkey) live in Turso beside the app's own, created with them
// (SCHEMA in _trips.ts); who is an owner, and the name attributions show,
// stay in `users` (syncUserRow).
//
// Previews sign in through production (the OAuth proxy): Google calls back
// only to production's address, which hands the preview an encrypted
// profile, and the preview makes the session in its own database. A
// preview builds any PR's code, Dependabot's included, so it holds nothing
// that makes a session on the real site: production keeps its own secret
// and the real Google client secret (previews get a stand-in; only
// production exchanges codes), refuses the proxy's completion routes
// (refusedRoute), and takes no Google ID token (`disableIdTokenSignIn`),
// which a preview is handed with each profile and production would
// otherwise accept for an hour. What the proxy secret still gives whoever
// holds it: production sends the Google profile (name, email, picture) of
// whoever finishes a sign-in it started to any address it names.

/** The production site, where Google sends every sign-in back to. */
export const PRODUCTION_ORIGIN = 'https://fog-and-frontier.vercel.app';

type Env = Record<string, string | undefined>;

const withoutSlash = (url: string) => url.replace(/\/+$/, '');

/**
 * This deployment's origin: what cookies and passkeys are bound to. A preview
 * is its branch's address (Vercel's "Preview" link), which stays the same
 * across the branch's pushes, so a passkey made there keeps working.
 */
export function authOrigin(env: Env = process.env): string {
  if (env.BETTER_AUTH_URL) return withoutSlash(env.BETTER_AUTH_URL);
  if (env.VERCEL_ENV === 'production') return PRODUCTION_ORIGIN;
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_BRANCH_URL)
    return `https://${env.VERCEL_BRANCH_URL}`;
  return 'http://localhost:3000';
}

/** Whether this deployment is the real site. */
export function isProduction(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production';
}

/**
 * The origins sign-in requests and redirects may come from or go to: this
 * deployment's own, a preview's per-deployment address too, and on a laptop
 * the Vite dev server's. No wildcard: a pattern on vercel.app could match a
 * stranger's project.
 */
export function trustedOrigins(env: Env = process.env): string[] {
  const own = authOrigin(env);
  if (isProduction(env)) return [own];
  if (env.VERCEL_ENV === 'preview') {
    return [...new Set([own, ...(env.VERCEL_URL ? [`https://${env.VERCEL_URL}`] : [])])];
  }
  return [...new Set([own, 'http://localhost:3000', 'http://localhost:5173'])];
}

/**
 * Better Auth's routes this deployment refuses, by route pattern (a hook's
 * `ctx.path`, after Better Auth has parsed the URL, however it was spelled):
 * changing an account's name, which is Google's given name and what
 * attributions show; and on production the proxy's completion routes, which
 * turn an encrypted profile into a session and which only a preview needs.
 */
export function refusedRoute(path: string | undefined, env: Env = process.env): boolean {
  if (path === '/update-user') return true;
  return (
    isProduction(env) && (path === '/callback/:id/oauth-proxy' || path === '/oauth-proxy-callback')
  );
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

/** Better Auth's options for this deployment. */
export function authOptions(env: Env = process.env) {
  const origin = authOrigin(env);
  return {
    appName: 'Fog and Frontier',
    baseURL: origin,
    secret: required(env, 'BETTER_AUTH_SECRET'),
    trustedOrigins: trustedOrigins(env),
    // Ahead of every plugin's hooks. Reads `env` as each request comes, so
    // a test can switch it.
    hooks: {
      before: createAuthMiddleware((ctx) => {
        if (refusedRoute(ctx.path, env)) throw new APIError('NOT_FOUND');
        return Promise.resolve();
      }),
    },
    database: { dialect: libsqlDialect(db), type: 'sqlite' as const, transaction: false },
    // The tables are the app's to create (SCHEMA in _trips.ts, checked
    // against what Better Auth writes by _betterAuth.test.ts), so a cold
    // instance's first sign-in doesn't spend a dozen queries inspecting
    // them.
    advanced: { database: { validateSchema: false } },
    user: { modelName: 'auth_user' },
    session: { modelName: 'auth_session' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    socialProviders: {
      google: {
        clientId: required(env, 'GOOGLE_CLIENT_ID'),
        // A preview never exchanges a code (production does, for it), but
        // the provider won't start a sign-in without some secret.
        clientSecret: isProduction(env)
          ? required(env, 'GOOGLE_CLIENT_SECRET')
          : (env.GOOGLE_CLIENT_SECRET ?? 'exchanged-by-production'),
        prompt: 'select_account' as const,
        // Sign-in is the redirect only; see the top of this file.
        disableIdTokenSignIn: true,
        // Each sign-in takes the account's name from Google again.
        overrideUserInfoOnSignIn: true,
        // The account's name is its first name: what attributions show
        // ("Tarun", not "Tarun Patel"), as Clerk's firstName was.
        mapProfileToUser: (profile: { given_name?: string; name?: string }) => ({
          name: (profile.given_name || profile.name || '').trim().slice(0, 50),
        }),
      },
    },
    plugins: [
      passkey({
        rpID: new URL(origin).hostname,
        rpName: 'Fog and Frontier',
        origin,
        schema: { passkey: { modelName: 'auth_passkey' } },
      }),
      oAuthProxy({
        productionURL: PRODUCTION_ORIGIN,
        secret: required(env, 'OAUTH_PROXY_SECRET'),
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // Each sign-in brings the account's `users` row up to date: an
          // owner's role and name, an editor's name (never a new row). One
          // that fails is logged, not the sign-in's failure: the next one
          // tries again.
          after: async (session: { userId: string }) => {
            try {
              const rs = await db().execute({
                sql: 'SELECT email, name FROM auth_user WHERE id = ?',
                args: [session.userId],
              });
              const row = rs.rows[0];
              if (!row || typeof row.email !== 'string') return;
              await syncUserRow(row.email, typeof row.name === 'string' ? row.name : null);
            } catch (err) {
              logServerError(err, { route: '/api/auth', detail: 'users row sync failed' });
            }
          },
        },
      },
    },
  };
}

const makeAuth = () => betterAuth(authOptions());
type Auth = ReturnType<typeof makeAuth>;
let instance: Auth | null = null;

/** This deployment's Better Auth, made on first use (its env read then). */
export function auth(): Auth {
  instance ??= makeAuth();
  return instance;
}
