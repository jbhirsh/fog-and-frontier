import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http, { type Server } from 'node:http';

// End-to-end test of the actual deployed module (api/graphql.ts): exercises the
// express app + express.json() body parsing + the lazy Apollo middleware +
// cached server.start() + buildContext + ensureAllSchemas, over a real HTTP
// socket. The broader graphql.test.ts builds its own ApolloServer, so this is
// the only coverage of the express wiring itself. DB is mocked at the boundary.

const { execute, batch } = vi.hoisted(() => ({ execute: vi.fn(), batch: vi.fn() }));
vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

process.env.OWNER_EMAILS = 'owner@example.com';
process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
process.env.OAUTH_PROXY_SECRET = 'p'.repeat(32);
process.env.GOOGLE_CLIENT_ID = 'id.apps.googleusercontent.com';

const app = (await import('./graphql.js')).default;

let server: Server;
let url: string;

beforeAll(async () => {
  execute.mockImplementation((q: unknown) => {
    const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
    if (/SELECT id, j FROM a ORDER BY t DESC/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            id: 'a1',
            j: JSON.stringify({
              id: 'a1',
              name: 'Trail',
              shortDescription: 's',
              category: 'hiking',
              region: 'sf',
              location: { city: 'X', coords: { lat: 1, lng: 2 } },
              duration: 'Half Day',
              coverImage: 'http://img',
            }),
          },
        ],
      });
    }
    return Promise.resolve({ rows: [], rowsAffected: 0 });
  });
  batch.mockResolvedValue([]);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  url = `http://127.0.0.1:${port}/api/graphql`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

type GqlResponse = {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

// Use node:http directly — the shared jsdom setup stubs global fetch to reject
// ("offline"), which would otherwise intercept this real in-process request.
function post(
  query: string,
  cookie?: string,
  contentType = 'application/json',
): Promise<{ status: number; json: GqlResponse; serverTiming?: string | string[] }> {
  const body = JSON.stringify({ query });
  const headers: Record<string, string | number> = {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  };
  if (cookie !== undefined) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            json: JSON.parse(data) as GqlResponse,
            serverTiming: res.headers['server-timing'],
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// A GET to a sign-in route (/api/auth/*), its status and body. The path goes
// out as written (no URL parsing here, which would turn a `\` into a `/`).
function get(path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    http
      .get({ hostname, port, path }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      })
      .on('error', reject);
  });
}

describe('api/graphql.ts express app (real wiring)', () => {
  it('serves a public query through express.json + Apollo', async () => {
    const r = await post('{ activities { id name } }');
    expect(r.status).toBe(200);
    const acts = r.json.data?.activities as Record<string, unknown>[] | undefined;
    expect(acts?.[0]).toMatchObject({ id: 'a1', name: 'Trail' });
  });

  // Profiling: each response says where its server time went.
  it('times the schema wait, the sign-in check and the operation', async () => {
    const r = await post('{ activities { id } }');
    expect(r.serverTiming).toMatch(
      /^schema;dur=\d+\.\d;desc="Schema setup", auth;dur=\d+\.\d;desc="Sign-in check", exec;dur=\d+\.\d;desc="Operation"$/,
    );
  });

  it('times an operation that fails too', async () => {
    const r = await post('{ trips { id } }');
    expect(r.json.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(r.serverTiming).toContain('exec;dur=');
  });

  it('anon → UNAUTHENTICATED via the context guard', async () => {
    const r = await post('{ trips { id } }');
    expect(r.json.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  // buildContext reads the session cookie: one that names no live session
  // (here, one Better Auth can't verify) is signed out, not an error.
  it('a session cookie naming no session resolves to anon', async () => {
    const r = await post('{ trips { id } }', '__Secure-better-auth.session_token=forged.value');
    expect(r.status).toBe(200);
    expect(r.json.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  // The session is a cookie, so a cross-site form post would carry it:
  // Apollo's CSRF prevention refuses a request a form could make.
  it('refuses a request a cross-site form could send', async () => {
    const r = await post('{ activities { id } }', undefined, 'text/plain');
    expect(r.status).toBe(400);
  });

  // Sign-in (Better Auth) is mounted on the same function, at /api/auth/*.
  it('serves the sign-in routes', async () => {
    const r = await get('/api/auth/ok');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });

  it('refuses the OAuth proxy’s completion on production', async () => {
    process.env.VERCEL_ENV = 'production';
    try {
      expect((await get('/api/auth/callback/google/oauth-proxy?callbackURL=x')).status).toBe(404);
      expect((await get('/api/auth/oauth-proxy-callback?callbackURL=x')).status).toBe(404);
      // Express reads this path as is; Better Auth as a URL, with a `/`.
      expect((await get('/api/auth/callback/google\\oauth-proxy?callbackURL=x')).status).toBe(404);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });

  // formatError logs only genuine server errors (#20); an expected,
  // client-facing error such as UNAUTHENTICATED must not reach the error log.
  it('does not log a user-facing error as a server error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const r = await post('{ trips { id } }');
      expect(r.json.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
