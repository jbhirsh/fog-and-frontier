import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http, { type Server } from 'node:http';
import { createRequire } from 'node:module';
import { GraphQLError } from 'graphql';

// End-to-end test of the actual deployed module (api/graphql.ts): exercises the
// express app + express.json() body parsing + the lazy Apollo middleware +
// cached server.start() + buildContext + ensureAllSchemas, over a real HTTP
// socket. The broader graphql.test.ts builds its own ApolloServer, so this is
// the only coverage of the express wiring itself. DB is mocked at the boundary.

const { execute, batch } = vi.hoisted(() => ({ execute: vi.fn(), batch: vi.fn() }));
vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));
// One graphql for all: vitest would load its ESM build for this repo's code
// and Node its CommonJS build for Apollo, two GraphQLError classes that fail
// each other's instanceof. Deployed, both are the CommonJS build.
vi.mock('graphql', () => createRequire(import.meta.url)('graphql') as object);
// Better Auth's node handler, spied on so a test can break a response midway.
vi.mock(import('better-auth/node'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, toNodeHandler: vi.fn(actual.toNodeHandler) };
});
// The real context, spied on so a test can make one request's context fail.
vi.mock(import('./_gqlContext.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildContext: vi.fn(actual.buildContext) };
});

process.env.OWNER_EMAILS = 'owner@example.com';
process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
process.env.OAUTH_PROXY_SECRET = 'p'.repeat(32);
process.env.GOOGLE_CLIENT_ID = 'id.apps.googleusercontent.com';

const app = (await import('./graphql.js')).default;
const { buildContext } = await import('./_gqlContext.js');
const { toNodeHandler } = await import('better-auth/node');

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
  ({ server, url } = await listen(app));
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

// Serves an app on a free port: the server and its /api/graphql URL.
async function listen(served: typeof app): Promise<{ server: Server; url: string }> {
  const listening = await new Promise<Server>((resolve) => {
    const s = served.listen(0, () => resolve(s));
  });
  const addr = listening.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server: listening, url: `http://127.0.0.1:${port}/api/graphql` };
}

type GqlResponse = {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

// Use node:http directly — the shared jsdom setup stubs global fetch to reject
// ("offline"), which would otherwise intercept this real in-process request.
type Posted = {
  status: number;
  json: GqlResponse;
  serverTiming?: string | string[];
  headers: http.IncomingHttpHeaders;
};

function post(query: string, cookie?: string, contentType?: string): Promise<Posted> {
  return postTo(url, query, cookie, contentType);
}

function postTo(
  target: string,
  query: string,
  cookie?: string,
  contentType = 'application/json',
): Promise<Posted> {
  const body = JSON.stringify({ query });
  const headers: Record<string, string | number> = {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  };
  if (cookie !== undefined) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request(
      target,
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
            headers: res.headers,
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
  // A fresh copy of the function, so this test has its cold start (the
  // schema setup is cached per module) wherever it runs in the file.
  it('sets the schema up once, for requests that arrive together at a cold start', async () => {
    vi.resetModules();
    const fresh = await listen((await import('./graphql.js')).default);
    // Only the context calls performance.now() before the schema is set up,
    // right before it waits for the setup: a call per request waiting on it.
    const now = vi.spyOn(performance, 'now');
    try {
      batch.mockClear();
      // Held until both requests are waiting on it.
      let finishSetup!: (results: unknown[]) => void;
      batch.mockImplementationOnce(
        () => new Promise<unknown[]>((resolve) => (finishSetup = resolve)),
      );
      now.mockClear();
      const both = Promise.all([
        postTo(fresh.url, '{ activities { id } }'),
        postTo(fresh.url, '{ activities { id } }'),
      ]);
      await vi.waitFor(() => expect(now).toHaveBeenCalledTimes(2));
      expect(batch).toHaveBeenCalledTimes(1);
      expect((batch.mock.calls[0]?.[0] as unknown[]).length).toBeGreaterThan(20);
      finishSetup([]);
      const [a, b] = await both;
      expect([a.status, b.status]).toEqual([200, 200]);

      expect((await postTo(fresh.url, '{ activities { id } }')).status).toBe(200);
      expect(batch).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      await new Promise((resolve) => fresh.server.close(resolve));
    }
  });

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

  // formatError logs what isn't the client's fault, by the error that caused
  // it: here, a context that couldn't be built.
  it('logs a server error with the error that caused it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('db down');
    vi.mocked(buildContext).mockRejectedValueOnce(cause);
    try {
      const r = await post('{ activities { id } }');
      expect(r.json.errors?.[0]?.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
      expect(consoleError).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(consoleError.mock.calls[0]?.[0] as string) as Record<
        string,
        unknown
      >;
      expect(entry).toMatchObject({
        route: '/api/graphql',
        method: 'POST',
        status: 500,
        detail: 'Context creation failed: db down',
        err: { name: 'Error', message: 'db down' },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('logs a server GraphQLError that has no cause as itself', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(buildContext).mockRejectedValueOnce(
      new GraphQLError('no schema', { extensions: { code: 'INTERNAL' } }),
    );
    try {
      const r = await post('{ activities { id } }');
      expect(r.json.errors?.[0]?.extensions?.code).toBe('INTERNAL');
      const entry = JSON.parse(consoleError.mock.calls[0]?.[0] as string) as Record<
        string,
        unknown
      >;
      expect(entry).toMatchObject({
        detail: 'no schema',
        err: { name: 'GraphQLError', message: 'no schema' },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each(['GRAPHQL_PARSE_FAILED', 'GRAPHQL_VALIDATION_FAILED'])(
    'does not log a request the client got wrong (%s)',
    async (code) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const query = code === 'GRAPHQL_PARSE_FAILED' ? '{ activities {' : '{ nope }';
        const r = await post(query);
        expect(r.json.errors?.[0]?.extensions?.code).toBe(code);
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  // What fails outside Apollo reaches the express error handler: logged, and
  // answered with a bare 500.
  it('answers an error outside Apollo with a logged 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(toNodeHandler).mockImplementationOnce(
      () => () => Promise.reject(new Error('auth down')),
    );
    try {
      const r = await get('/api/auth/ok');
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body)).toEqual({ errors: [{ message: 'internal server error' }] });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(consoleError.mock.calls[0]?.[0] as string) as Record<
        string,
        unknown
      >;
      expect(entry).toMatchObject({
        route: '/api/graphql',
        method: 'GET',
        status: 500,
        err: { name: 'Error', message: 'auth down' },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('times a signed-in request’s parts within the request', async () => {
    vi.mocked(buildContext).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { caller: { email: 'owner@example.com', role: 'owner' } };
    });
    const t0 = performance.now();
    const r = await post('{ trips { id } }');
    const elapsed = performance.now() - t0;
    // The caller reached the resolvers: a signed-in caller's (empty) list.
    expect(r.json).toEqual({ data: { trips: [] } });
    const durs = Object.fromEntries(
      [...String(r.serverTiming).matchAll(/(\w+);dur=([\d.]+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(Object.keys(durs)).toEqual(['schema', 'auth', 'exec']);
    expect(durs.auth).toBeGreaterThanOrEqual(20);
    for (const dur of Object.values(durs)) expect(dur).toBeLessThanOrEqual(elapsed);
  });

  it('answers any origin (CORS)', async () => {
    const r = await post('{ activities { id } }');
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });

  // An error once the response has started can't be answered with a clean
  // 500: it is logged, and express closes the connection.
  it('logs an error after the response started, and cuts the response off', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(toNodeHandler).mockImplementationOnce(() => (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('part');
      return Promise.reject(new Error('stream broke'));
    });
    try {
      const { hostname, port } = new URL(url);
      const outcome = await new Promise<{ status: number; complete: boolean }>(
        (resolve, reject) => {
          http
            .get({ hostname, port, path: '/api/auth/ok' }, (res) => {
              res.resume();
              res.on('close', () =>
                resolve({ status: res.statusCode ?? 0, complete: res.complete }),
              );
            })
            .on('error', reject);
        },
      );
      expect(outcome).toEqual({ status: 200, complete: false });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(consoleError.mock.calls[0]?.[0] as string) as Record<
        string,
        unknown
      >;
      expect(entry).toMatchObject({
        method: 'GET',
        status: 500,
        err: { message: 'stream broke' },
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
