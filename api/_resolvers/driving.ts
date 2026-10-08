import { db } from '../_db.js';
import { badInput } from '../_gqlError.js';
import type { GqlContext } from '../_gqlContext.js';
import { logServerError } from '../_log.js';

// Road miles from a point to every catalog activity (#66). The catalog's
// straight-line distances understate the drive, often by a third on Bay Area
// roads, so the client asks for real driving distances and shows those. They
// come from OpenRouteService's matrix API (one request covers the whole
// catalog) using ORS_API_KEY. Without a key, when the service fails, or once
// this hour's lookup budget is spent, the query returns nothing and the
// client keeps its straight-line estimate.
//
// The origin is rounded to two decimals (about 1 km) before it leaves for
// OpenRouteService or becomes a cache key: plenty for a mileage label, and
// the visitor's exact position is never sent on.

// api.heigit.org replaced the deprecated api.openrouteservice.org host.
export const ORS_MATRIX_URL =
  'https://api.heigit.org/openrouteservice/v2/matrix/driving-car';

/** Destinations per matrix request, within the free plan's per-request cap. */
export const ORS_BATCH = 1000;

/** How long a computed origin's distances are reused. */
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Origins kept in memory; the oldest is dropped past this. */
export const CACHE_MAX = 200;

/** How long to wait for OpenRouteService before giving up. */
export const ORS_TIMEOUT_MS = 8000;

/**
 * Where road miles are looked up: the West Coast the catalog covers, with
 * room to spare. An origin outside it gets none (straight-line estimates
 * instead), so a script walking the globe can't spend the daily quota.
 */
export const SERVICE_AREA = { south: 32, north: 49.5, west: -125, east: -114 };

interface Point {
  lat: number;
  lng: number;
}

interface Destination {
  id: string;
  coords: Point;
}

/** Two decimals, about 1 km. */
export function coarse(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Driving miles from `origin` to each destination, keyed by id. A destination
 * the router can't reach (an island, a bad coordinate) is left out.
 */
export async function fetchDrivingMiles(
  apiKey: string,
  origin: Point,
  destinations: Destination[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let start = 0; start < destinations.length; start += ORS_BATCH) {
    const batch = destinations.slice(start, start + ORS_BATCH);
    const res = await fetch(ORS_MATRIX_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations: [
          [origin.lng, origin.lat],
          ...batch.map((d) => [d.coords.lng, d.coords.lat]),
        ],
        sources: [0],
        destinations: batch.map((_, i) => i + 1),
        metrics: ['distance'],
        units: 'mi',
      }),
    });
    if (!res.ok) throw new Error(`openrouteservice matrix: HTTP ${res.status}`);
    const body = (await res.json()) as { distances?: unknown };
    const row: unknown = Array.isArray(body.distances) ? body.distances[0] : null;
    if (!Array.isArray(row) || row.length !== batch.length) {
      throw new Error('openrouteservice matrix: malformed response');
    }
    batch.forEach((d, i) => {
      const miles: unknown = row[i];
      if (typeof miles === 'number') out.set(d.id, miles);
    });
  }
  return out;
}

// The catalog's ids and coordinates, read straight from the stored JSON. A row
// without usable coordinates is skipped (`activities` reports bad rows), as is
// (0, 0), the app's "never set" location, which no road reaches.
async function catalogDestinations(): Promise<Destination[]> {
  const rs = await db().execute('SELECT id, j FROM a');
  const out: Destination[] = [];
  for (const row of rs.rows) {
    const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : null;
    if (id === null || typeof row.j !== 'string') continue;
    let parsed: { location?: { coords?: unknown } } | null;
    try {
      parsed = JSON.parse(row.j) as typeof parsed;
    } catch {
      continue;
    }
    const { lat, lng } = (parsed?.location?.coords ?? {}) as Record<string, unknown>;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (lat === 0 && lng === 0) continue;
    out.push({ id, coords: { lat, lng } });
  }
  return out;
}

/** How long the catalog's destinations are reused before reading them again. */
export const CATALOG_TTL_MS = 60 * 1000;

interface Catalog {
  at: number;
  destinations: Destination[];
  /** Ids and coordinates, so a new or moved activity recomputes. */
  fingerprint: string;
}

// Kept briefly so a burst of requests, cached or not, reads the table once
// rather than once per request.
let catalogCache: Catalog | null = null;

/**
 * Drop the cached catalog after a write, so this instance's next lookup sees
 * a new or moved activity at once. Other instances catch up within
 * CATALOG_TTL_MS.
 */
export function forgetCatalog(): void {
  catalogCache = null;
}

async function loadCatalog(): Promise<Catalog> {
  if (catalogCache && Date.now() - catalogCache.at <= CATALOG_TTL_MS) return catalogCache;
  const destinations = await catalogDestinations();
  catalogCache = {
    at: Date.now(),
    destinations,
    fingerprint: destinations.map((d) => `${d.id}@${d.coords.lat},${d.coords.lng}`).join(';'),
  };
  return catalogCache;
}

interface CacheEntry {
  at: number;
  /** The destinations asked for, so a new or moved activity recomputes. */
  fingerprint: string;
  miles: Map<string, number>;
}

// Per function instance. Origins are coarse, so visitors near each other and
// repeat visits share an entry.
const cache = new Map<string, CacheEntry>();

// Lookups under way, so simultaneous misses for one origin share a request.
const inflight = new Map<string, Promise<CacheEntry | null>>();

/**
 * Uncached lookups allowed per clock hour across every instance, counted in
 * Turso. 20 an hour stays under the free plan's 500 a day, so no caller,
 * however many origins it tries, can exhaust the daily quota.
 */
export const ORS_HOURLY_BUDGET = 20;

/**
 * How much of that budget signed-out callers may use. The rest stays for the
 * people who use the app, so a script can't lock them out of road miles.
 */
export const ANON_HOURLY_BUDGET = 12;

let usageTable: Promise<unknown> | null = null;

/** Test hook: forget every cached origin and the table check. */
export function clearDrivingCache(): void {
  cache.clear();
  catalogCache = null;
  usageTable = null;
}

/**
 * Claims one lookup from this hour's budget; false once the caller's share is
 * spent. The conditional upsert counts and checks in one atomic statement, so
 * instances racing for the last slot can't both win it.
 */
async function claimLookup(signedIn: boolean): Promise<boolean> {
  usageTable ??= db()
    .execute('CREATE TABLE IF NOT EXISTS ors_usage (hour TEXT PRIMARY KEY, n INTEGER NOT NULL)')
    .catch((err: unknown) => {
      usageTable = null;
      throw err;
    });
  await usageTable;
  const rs = await db().execute({
    sql: `INSERT INTO ors_usage (hour, n) VALUES (?, 1)
          ON CONFLICT (hour) DO UPDATE SET n = n + 1 WHERE n < ?
          RETURNING n`,
    args: [
      new Date().toISOString().slice(0, 13),
      signedIn ? ORS_HOURLY_BUDGET : ANON_HOURLY_BUDGET,
    ],
  });
  return rs.rows.length > 0;
}

async function lookUp(
  apiKey: string,
  key: string,
  origin: Point,
  destinations: Destination[],
  fingerprint: string,
  signedIn: boolean,
): Promise<CacheEntry | null> {
  try {
    if (!(await claimLookup(signedIn))) return null;
    const miles = await fetchDrivingMiles(apiKey, origin, destinations);
    const entry = { at: Date.now(), fingerprint, miles };
    // Re-inserting moves a recomputed origin to the newest end.
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return entry;
  } catch (err) {
    logServerError(err, { route: '/api/graphql', detail: 'drivingMiles' });
    return null;
  }
}

async function drivingMiles(
  _: unknown,
  { lat, lng }: { lat: number; lng: number },
  ctx: Partial<GqlContext>,
): Promise<{ id: string; miles: number }[]> {
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
    throw badInput('lat must be within ±90 and lng within ±180');
  }
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return [];
  const { south, north, west, east } = SERVICE_AREA;
  if (lat < south || lat > north || lng < west || lng > east) return [];

  const origin = { lat: coarse(lat), lng: coarse(lng) };
  const key = `${origin.lat},${origin.lng}`;
  const { destinations, fingerprint } = await loadCatalog();

  let entry: CacheEntry | null | undefined = cache.get(key);
  if (!entry || entry.fingerprint !== fingerprint || Date.now() - entry.at > CACHE_TTL_MS) {
    const pendingKey = `${key};${fingerprint}`;
    let pending = inflight.get(pendingKey);
    if (!pending) {
      pending = lookUp(apiKey, key, origin, destinations, fingerprint, Boolean(ctx.caller));
      inflight.set(pendingKey, pending);
      void pending.finally(() => inflight.delete(pendingKey));
    }
    entry = await pending;
    if (!entry) return [];
  }
  return [...entry.miles].map(([id, miles]) => ({ id, miles }));
}

export const drivingQuery = { drivingMiles };
