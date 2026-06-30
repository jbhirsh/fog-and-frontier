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
    return Promise.resolve({ rows: [] });
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
function post(query: string): Promise<{ status: number; json: GqlResponse }> {
  const body = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) as GqlResponse }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('api/graphql.ts express app (real wiring)', () => {
  it('serves a public query through express.json + Apollo', async () => {
    const r = await post('{ activities { id name } }');
    expect(r.status).toBe(200);
    const acts = r.json.data?.activities as Record<string, unknown>[] | undefined;
    expect(acts?.[0]).toMatchObject({ id: 'a1', name: 'Trail' });
  });

  it('anon → UNAUTHENTICATED via the context guard', async () => {
    const r = await post('{ trips { id } }');
    expect(r.json.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
