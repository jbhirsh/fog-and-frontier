import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ApolloServer } from '@apollo/server';

// Driving miles (#66). Exercised through the schema, mocking only the `db`
// boundary and `fetch` (OpenRouteService). The db fake serves the catalog and
// keeps a real in-memory `ors_usage` table with the upsert's semantics, so the
// hourly budget is actually counted rather than stubbed.

const { execute, batch } = vi.hoisted(() => ({ execute: vi.fn(), batch: vi.fn() }));
vi.mock('../_db.js', () => ({ db: () => ({ execute, batch }) }));

const { typeDefs } = await import('../_schema.js');
const { resolvers } = await import('./index.js');
const {
  ANON_HOURLY_BUDGET,
  CACHE_MAX,
  CACHE_TTL_MS,
  CATALOG_TTL_MS,
  ORS_BATCH,
  ORS_HOURLY_BUDGET,
  ORS_MATRIX_URL,
  SERVICE_AREA,
  clearDrivingCache,
  coarse,
} = await import('./driving.js');

const server = new ApolloServer({ typeDefs, resolvers });
beforeAll(() => server.start());

type Result = {
  data?: { drivingMiles: { id: string; miles: number }[] } | null;
  errors?: { extensions?: Record<string, unknown> }[];
};

const QUERY = 'query ($lat: Float!, $lng: Float!) { drivingMiles(lat: $lat, lng: $lng) { id miles } }';

const SIGNED_IN = { email: 'jess@example.com', role: 'owner' as const };

async function run(
  lat: number,
  lng: number,
  caller: typeof SIGNED_IN | null = null,
): Promise<Result> {
  const res = await server.executeOperation(
    { query: QUERY, variables: { lat, lng } },
    { contextValue: { caller } },
  );
  if (res.body.kind !== 'single') throw new Error('expected single result');
  return res.body.singleResult as Result;
}

function row(id: string | number, j: unknown) {
  return { id, j: typeof j === 'string' ? j : JSON.stringify(j) };
}
const at = (lat: number, lng: number) => ({ location: { coords: { lat, lng } } });

type Row = { id: string | number | null; j: unknown };
let catalogRows: Row[];
let usage: Map<string, number>;

function catalog(rows: Row[]) {
  catalogRows = rows;
}

function fakeDb(q: string | { sql: string; args: unknown[] }) {
  const sql = typeof q === 'string' ? q : q.sql;
  if (sql === 'SELECT id, j FROM a') return { rows: catalogRows };
  if (sql.startsWith('INSERT INTO a ')) return { rows: [] };
  // deleteActivity looks up the activity's photos (#19); none here.
  if (sql.includes('FROM activity_photos')) return { rows: [] };
  if (sql.startsWith('CREATE TABLE IF NOT EXISTS ors_usage')) return { rows: [] };
  if (sql.startsWith('INSERT INTO ors_usage') && typeof q !== 'string') {
    expect(sql).toMatch(/ON CONFLICT \(hour\) DO UPDATE SET n = n \+ 1 WHERE n < \?\s+RETURNING n/);
    const [hour, limit] = q.args as [string, number];
    const n = usage.get(hour);
    if (n === undefined) {
      usage.set(hour, 1);
      return { rows: [{ n: 1 }] };
    }
    if (n >= limit) return { rows: [] };
    usage.set(hour, n + 1);
    return { rows: [{ n: n + 1 }] };
  }
  throw new Error(`unexpected SQL: ${sql}`);
}

function sqlCalls(prefix: string) {
  return execute.mock.calls.filter(([q]) =>
    (typeof q === 'string' ? q : (q as { sql: string }).sql).startsWith(prefix),
  );
}

function orsReplies(...rows: unknown[][]) {
  const fetchMock = vi.fn();
  for (const distances of rows) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ distances: [distances] }), { status: 200 }),
    );
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string) as {
    locations: number[][];
    sources: number[];
    destinations: number[];
    metrics: string[];
    units: string;
  };
}

let errorLog: MockInstance<typeof console.error>;
beforeEach(() => {
  process.env.ORS_API_KEY = 'test-key';
  clearDrivingCache();
  catalogRows = [];
  usage = new Map();
  execute.mockReset();
  batch.mockReset();
  batch.mockResolvedValue([]);
  execute.mockImplementation((q: Parameters<typeof fakeDb>[0]) => Promise.resolve(fakeDb(q)));
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  errorLog.mockRestore();
  delete process.env.ORS_API_KEY;
});

describe('coarse', () => {
  it('rounds to two decimals', () => {
    expect(coarse(37.33829)).toBe(37.34);
    expect(coarse(-121.88634)).toBe(-121.89);
  });
});

describe('drivingMiles', () => {
  it('asks OpenRouteService for road miles from the coarse origin', async () => {
    catalog([row('muir', at(37.897, -122.5811)), row(7, at(36.6, -121.9))]);
    const fetchMock = orsReplies([71.2, 70.4]);

    const r = await run(37.33829, -121.88634);

    expect(r.data?.drivingMiles).toEqual([
      { id: 'muir', miles: 71.2 },
      { id: '7', miles: 70.4 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ORS_MATRIX_URL);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Authorization: 'test-key', 'Content-Type': 'application/json' });
    expect(sentBody(fetchMock)).toEqual({
      locations: [
        [-121.89, 37.34],
        [-122.5811, 37.897],
        [-121.9, 36.6],
      ],
      sources: [0],
      destinations: [1, 2],
      metrics: ['distance'],
      units: 'mi',
    });
  });

  it('leaves out destinations the router cannot reach', async () => {
    catalog([row('a', at(37, -122)), row('b', at(21, -157)), row('c', at(38, -122))]);
    orsReplies([10, null, '7']);
    expect((await run(37, -122)).data?.drivingMiles).toEqual([{ id: 'a', miles: 10 }]);
  });

  it('skips rows without usable coordinates', async () => {
    catalog([
      { id: null, j: JSON.stringify(at(37, -122)) },
      { id: 'nojson', j: null },
      row('broken', '{not json'),
      row('null', 'null'),
      row('nocoords', { location: {} }),
      row('noloc', {}),
      row('strings', { location: { coords: { lat: '37', lng: -122 } } }),
      row('nolng', { location: { coords: { lat: 37 } } }),
      row('unset', at(0, 0)),
      row('equator', at(0, -122)),
      row('meridian', at(37, 0)),
      row('ok', at(37, -122)),
    ]);
    const fetchMock = orsReplies([1, 2, 5]);
    expect((await run(37, -122)).data?.drivingMiles).toEqual([
      { id: 'equator', miles: 1 },
      { id: 'meridian', miles: 2 },
      { id: 'ok', miles: 5 },
    ]);
    expect(sentBody(fetchMock).destinations).toEqual([1, 2, 3]);
  });

  it('makes no request for an empty catalog', async () => {
    catalog([]);
    const fetchMock = orsReplies([]);
    expect((await run(37, -122)).data?.drivingMiles).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing, without calling out, when no API key is set', async () => {
    delete process.env.ORS_API_KEY;
    catalog([row('a', at(37, -122))]);
    const fetchMock = orsReplies([5]);
    expect((await run(37, -122)).data?.drivingMiles).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [90.01, 0],
    [-90.01, 0],
    [0, 180.01],
    [0, -180.01],
  ])('rejects an origin off the globe (%s, %s)', async (lat, lng) => {
    const r = await run(lat, lng);
    expect(r.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('accepts the edges of the globe', async () => {
    catalog([]);
    vi.stubGlobal('fetch', vi.fn());
    expect((await run(90, 180)).errors).toBeUndefined();
    expect((await run(-90, -180)).errors).toBeUndefined();
  });

  it.each([
    ['south', SERVICE_AREA.south - 0.01, -120],
    ['north', SERVICE_AREA.north + 0.01, -120],
    ['west', 40, SERVICE_AREA.west - 0.01],
    ['east', 40, SERVICE_AREA.east + 0.01],
  ])('returns nothing, without calling out, for an origin %s of the West Coast', async (_, lat, lng) => {
    catalog([row('a', at(37, -122))]);
    const fetchMock = orsReplies([5]);
    expect((await run(lat, lng)).data?.drivingMiles).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('leaves out an origin beyond the West Coast, like Salt Lake City', async () => {
    catalog([row('a', at(37, -122))]);
    const fetchMock = orsReplies([5]);
    expect((await run(40.76, -111.89)).data?.drivingMiles).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [SERVICE_AREA.south, SERVICE_AREA.west],
    [SERVICE_AREA.north, SERVICE_AREA.east],
  ])('serves the corners of the West Coast area (%s, %s)', async (lat, lng) => {
    catalog([row('a', at(37, -122))]);
    orsReplies([5]);
    expect((await run(lat, lng)).data?.drivingMiles).toEqual([{ id: 'a', miles: 5 }]);
  });

  it('returns nothing and logs when the service fails', async () => {
    catalog([row('a', at(37, -122))]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota', { status: 429 })));
    expect((await run(37, -122)).data?.drivingMiles).toEqual([]);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = String(errorLog.mock.calls[0][0]);
    expect(logged).toContain('HTTP 429');
    expect(logged).toContain('"detail":"drivingMiles"');
  });

  it.each([
    ['no matrix', {}],
    ['an empty matrix', { distances: [] }],
    ['a short row', { distances: [[]] }],
  ])('treats %s as a failure', async (_, body) => {
    catalog([row('a', at(37, -122))]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    expect((await run(37, -122)).data?.drivingMiles).toEqual([]);
    expect(String(errorLog.mock.calls[0][0])).toContain('malformed response');
  });

  it('splits a large catalog into batches', async () => {
    const rows = Array.from({ length: ORS_BATCH + 1 }, (_, i) => row(`a${i}`, at(37, -122)));
    catalog(rows);
    const fetchMock = orsReplies(Array(ORS_BATCH).fill(1), [2]);

    const miles = (await run(37, -122)).data?.drivingMiles ?? [];

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0).destinations).toHaveLength(ORS_BATCH);
    expect(sentBody(fetchMock, 1).locations).toHaveLength(2);
    expect(sentBody(fetchMock, 1).destinations).toEqual([1]);
    expect(miles).toHaveLength(ORS_BATCH + 1);
    expect(miles[ORS_BATCH]).toEqual({ id: `a${ORS_BATCH}`, miles: 2 });
  });

  describe('cache', () => {
    it('reuses an origin within the same ~1 km', async () => {
      catalog([row('a', at(37, -122))]);
      const fetchMock = orsReplies([5]);
      await run(37.331, -121.881);
      expect((await run(37.334, -121.884)).data?.drivingMiles).toEqual([{ id: 'a', miles: 5 }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still reuses an origin an hour later', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      catalog([row('a', at(37, -122))]);
      const fetchMock = orsReplies([5]);
      await run(37, -122);
      vi.advanceTimersByTime(60 * 60 * 1000);
      await run(37, -122);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reads the catalog once a minute, however many requests arrive', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      catalog([row('a', at(37, -122))]);
      orsReplies([5], [6], [7]);
      await run(37, -122);
      await run(37, -122);
      vi.advanceTimersByTime(30 * 1000);
      await run(37.5, -122);
      vi.advanceTimersByTime(CATALOG_TTL_MS - 30 * 1000);
      await run(37, -122);
      expect(sqlCalls('SELECT id, j FROM a')).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await run(37, -122);
      expect(sqlCalls('SELECT id, j FROM a')).toHaveLength(2);
    });

    it('asks again for a different origin', async () => {
      catalog([row('a', at(37, -122))]);
      const fetchMock = orsReplies([5], [9]);
      await run(37.33, -121.88);
      expect((await run(37.8, -122.4)).data?.drivingMiles).toEqual([{ id: 'a', miles: 9 }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('asks again when an activity moves', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      catalog([row('a', at(37, -122))]);
      const fetchMock = orsReplies([5], [8]);
      await run(37, -122);
      catalog([row('a', at(37.5, -122))]);
      vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
      expect((await run(37, -122)).data?.drivingMiles).toEqual([{ id: 'a', miles: 8 }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('asks again when the catalog changes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      catalog([row('a', at(37, -122))]);
      const fetchMock = orsReplies([5], [5, 6]);
      await run(37, -122);
      catalog([row('a', at(37, -122)), row('b', at(38, -122))]);
      vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
      expect((await run(37, -122)).data?.drivingMiles).toEqual([
        { id: 'a', miles: 5 },
        { id: 'b', miles: 6 },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('asks again once an entry is older than the TTL', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      catalog([row('a', at(37, -122))]);
      const fetchMock = orsReplies([5], [6], [7]);
      await run(37, -122);
      vi.advanceTimersByTime(CACHE_TTL_MS);
      await run(37, -122);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect((await run(37, -122)).data?.drivingMiles).toEqual([{ id: 'a', miles: 6 }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failure', async () => {
      catalog([row('a', at(37, -122))]);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('down', { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ distances: [[5]] })));
      vi.stubGlobal('fetch', fetchMock);
      expect((await run(37, -122)).data?.drivingMiles).toEqual([]);
      expect((await run(37, -122)).data?.drivingMiles).toEqual([{ id: 'a', miles: 5 }]);
    });

    it('drops the least recently computed origin past its size cap', async () => {
      catalog([row('a', at(37, -122))]);
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ distances: [[1]] }))),
      );
      vi.stubGlobal('fetch', fetchMock);
      const origin = (i: number) => [33 + i / 100, -118] as const;
      for (let i = 0; i <= CACHE_MAX; i++) {
        usage.clear(); // budget is tested on its own below
        await run(...origin(i));
      }
      expect(fetchMock).toHaveBeenCalledTimes(CACHE_MAX + 1);

      await run(...origin(CACHE_MAX)); // newest: still cached
      expect(fetchMock).toHaveBeenCalledTimes(CACHE_MAX + 1);
      await run(...origin(1)); // second oldest: still cached
      expect(fetchMock).toHaveBeenCalledTimes(CACHE_MAX + 1);
      await run(...origin(0)); // oldest: evicted
      expect(fetchMock).toHaveBeenCalledTimes(CACHE_MAX + 2);
    });

    it('counts a recomputed origin as new', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      catalog([row('a', at(37, -122))]);
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ distances: [[1]] }))),
      );
      vi.stubGlobal('fetch', fetchMock);
      const origin = (i: number) => [33 + i / 100, -118] as const;
      await run(...origin(0));
      vi.advanceTimersByTime(CACHE_TTL_MS + 1);
      const fresh = (i: number) => {
        usage.clear(); // budget is tested on its own below
        return run(...origin(i));
      };
      for (let i = 1; i < CACHE_MAX; i++) await fresh(i);
      await fresh(0); // expired: recomputed, now the newest
      await fresh(CACHE_MAX); // one past the cap evicts the oldest: origin 1
      const calls = fetchMock.mock.calls.length;
      await fresh(0);
      expect(fetchMock).toHaveBeenCalledTimes(calls);
      await fresh(1);
      expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
    });
  });
});

describe('drivingMiles hourly budget', () => {
  const origin = (i: number) => [33 + i / 100, -118] as const;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T16:20:00Z'));
    catalog([row('a', at(37, -122))]);
    fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ distances: [[1]] }))));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('counts lookups by clock hour', async () => {
    await run(...origin(0));
    expect(usage).toEqual(new Map([['2026-10-08T16', 1]]));
  });

  it('caps signed-out callers below the hourly budget', async () => {
    for (let i = 0; i < ANON_HOURLY_BUDGET; i++) {
      expect((await run(...origin(i))).data?.drivingMiles).toEqual([{ id: 'a', miles: 1 }]);
    }
    expect((await run(...origin(ANON_HOURLY_BUDGET))).data?.drivingMiles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(ANON_HOURLY_BUDGET);
    // Signed-in callers keep the rest of the hour.
    expect(
      (await run(...origin(ANON_HOURLY_BUDGET), SIGNED_IN)).data?.drivingMiles,
    ).toEqual([{ id: 'a', miles: 1 }]);
  });

  it('caps signed-in callers at the hourly budget', async () => {
    for (let i = 0; i < ORS_HOURLY_BUDGET; i++) await run(...origin(i), SIGNED_IN);
    expect((await run(...origin(ORS_HOURLY_BUDGET), SIGNED_IN)).data?.drivingMiles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(ORS_HOURLY_BUDGET);
  });

  it('starts afresh the next hour', async () => {
    for (let i = 0; i < ORS_HOURLY_BUDGET; i++) await run(...origin(i), SIGNED_IN);
    vi.setSystemTime(new Date('2026-10-08T17:00:00Z'));
    expect((await run(...origin(ORS_HOURLY_BUDGET))).data?.drivingMiles).toEqual([
      { id: 'a', miles: 1 },
    ]);
  });

  it('serves cached origins without spending budget', async () => {
    await run(...origin(0));
    for (let i = 0; i < ORS_HOURLY_BUDGET + 5; i++) await run(...origin(0));
    expect(usage.get('2026-10-08T16')).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates the usage table once per instance', async () => {
    await run(...origin(0));
    await run(...origin(1));
    expect(sqlCalls('CREATE TABLE IF NOT EXISTS ors_usage')).toHaveLength(1);
  });

  it('logs, and tries the table again, when it cannot be created', async () => {
    execute.mockImplementationOnce(() => Promise.resolve(fakeDb('SELECT id, j FROM a')));
    execute.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    expect((await run(...origin(0))).data?.drivingMiles).toEqual([]);
    expect(String(errorLog.mock.calls[0][0])).toContain('db down');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await run(...origin(0))).data?.drivingMiles).toEqual([{ id: 'a', miles: 1 }]);
    expect(sqlCalls('CREATE TABLE IF NOT EXISTS ors_usage')).toHaveLength(2);
  });

  it('shares one lookup between simultaneous requests for an origin', async () => {
    const [a, b] = await Promise.all([run(...origin(0)), run(...origin(0))]);
    expect(a.data?.drivingMiles).toEqual([{ id: 'a', miles: 1 }]);
    expect(b.data?.drivingMiles).toEqual([{ id: 'a', miles: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage.get('2026-10-08T16')).toBe(1);
  });

  it('shares a failed lookup too, then tries again afterwards', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
    const [a, b] = await Promise.all([run(...origin(0)), run(...origin(0))]);
    expect(a.data?.drivingMiles).toEqual([]);
    expect(b.data?.drivingMiles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await run(...origin(0))).data?.drivingMiles).toEqual([{ id: 'a', miles: 1 }]);
  });
});

describe('drivingMiles after a catalog write', () => {
  const OWNER = { email: 'jess@example.com', role: 'owner' as const };
  const SAVE =
    'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }';
  const DELETE = 'mutation($i: DeleteActivityInput!){ deleteActivity(input:$i){ deletedId } }';

  async function write(query: string, variables: Record<string, unknown>) {
    const res = await server.executeOperation(
      { query, variables },
      { contextValue: { caller: OWNER } },
    );
    if (res.body.kind !== 'single') throw new Error('expected single result');
    expect(res.body.singleResult.errors).toBeUndefined();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    catalog([row('a', at(37, -122))]);
  });

  it('sees a saved activity at once, without waiting out the catalog cache', async () => {
    const fetchMock = orsReplies([5], [5, 9]);
    await run(37, -122);
    catalog([row('a', at(37, -122)), row('b', at(38, -122))]);
    await write(SAVE, {
      i: {
        id: 'b',
        activity: {
          name: 'Trail',
          shortDescription: 's',
          category: 'hiking',
          region: 'sf',
          location: { city: 'X', coords: { lat: 38, lng: -122 } },
          duration: 'Half Day',
          coverImage: 'http://img',
        },
      },
    });
    expect((await run(37, -122)).data?.drivingMiles).toEqual([
      { id: 'a', miles: 5 },
      { id: 'b', miles: 9 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sqlCalls('SELECT id, j FROM a')).toHaveLength(2);
  });

  it('drops a deleted activity at once', async () => {
    catalog([row('a', at(37, -122)), row('b', at(38, -122))]);
    orsReplies([5, 9], [5]);
    await run(37, -122);
    catalog([row('a', at(37, -122))]);
    await write(DELETE, { i: { id: 'b' } });
    expect((await run(37, -122)).data?.drivingMiles).toEqual([{ id: 'a', miles: 5 }]);
  });
});
