import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint tests for the voting lifecycle (#51 PR2): trip-votes,
// trip-lifecycle (transition/revert via ?to=). We mock @clerk/backend and
// _db. Because every handler runs ensureTripsSchema() first (which issues many
// CREATE TABLE / backfill statements), we route db().execute by SQL substring
// rather than by call order, and assert on the meaningful calls.

const { verifyToken, getUser } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));
const { execute, batch } = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('@clerk/backend', () => ({
  verifyToken,
  createClerkClient: () => ({ users: { getUser } }),
}));
vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

process.env.CLERK_SECRET_KEY = 'sk_test_dummy';
process.env.OWNER_EMAILS = 'owner@example.com';

const votesHandler = (await import('./trip-votes.js')).default;
// transition-planning + revert-to-voting are consolidated into trip-lifecycle
// (dispatch on ?to=) to stay under Vercel's function cap.
const lifecycleHandler = (await import('./trip-lifecycle.js')).default;

const OWNER = 'owner@example.com';

type State = {
  trip: Record<string, unknown> | null;
  isMember: boolean;
  taOnTrip: boolean;
  activities: Array<{ id: string }>;
};

let state: State;

function routeExecute(q: unknown) {
  const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
  if (/SELECT id FROM trip_activities WHERE id = \? AND trip_id/.test(sql)) {
    return { rows: state.taOnTrip ? [{ id: 'ta1' }] : [] };
  }
  if (/FROM trips WHERE id/.test(sql)) {
    return { rows: state.trip ? [state.trip] : [] };
  }
  if (/FROM trip_members WHERE trip_id/.test(sql)) {
    return { rows: state.isMember ? [{ '1': 1 }] : [] };
  }
  if (/SELECT \* FROM trip_activities\s+WHERE trip_id/.test(sql)) {
    return { rows: state.activities };
  }
  return { rows: [] };
}

function tripRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip1',
    creator_email: OWNER,
    title: 'T',
    description: null,
    start_date: '2025-07-01',
    end_date: '2025-07-03',
    cover_image_url: null,
    status: 'voting',
    created_at: 1,
    marked_past_at: null,
    ...overrides,
  };
}

function signInOwner() {
  verifyToken.mockResolvedValue({ sub: 'u1' });
  getUser.mockResolvedValue({
    primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress: OWNER }],
  });
}

function fakeReq(opts: {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
}): VercelRequest {
  return {
    method: opts.method ?? 'POST',
    query: opts.query ?? {},
    body: opts.body,
    headers: { authorization: 'Bearer tok' },
  } as unknown as VercelRequest;
}

type CapturingRes = VercelResponse & { statusCode: number; body: unknown };
function fakeRes(): CapturingRes {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as CapturingRes;
}

function batchStmtSqls(): string[] {
  const calls = batch.mock.calls;
  if (calls.length === 0) return [];
  const stmts = calls[0]?.[0] as Array<{ sql: string }>;
  return stmts.map((s) => s.sql);
}

afterEach(() => {
  verifyToken.mockReset();
  getUser.mockReset();
  execute.mockReset();
  batch.mockReset();
});

function setup(partial: Partial<State>) {
  state = {
    trip: tripRow(),
    isMember: true,
    taOnTrip: true,
    activities: [],
    ...partial,
  };
  signInOwner();
  execute.mockImplementation((q: unknown) => Promise.resolve(routeExecute(q)));
  batch.mockResolvedValue([]);
}

describe('POST /api/trip-votes', () => {
  it('409s when the trip is not in voting', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const res = fakeRes();
    await votesHandler(
      fakeReq({ body: { trip_id: 'trip1', trip_activity_id: 'ta1', value: 1 } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect((res.body as { code?: string }).code).toBe('not_voting');
  });

  it('upserts a vote row for value ±1 while voting', async () => {
    setup({});
    const res = fakeRes();
    await votesHandler(
      fakeReq({ body: { trip_id: 'trip1', trip_activity_id: 'ta1', value: 1 } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /INSERT INTO trip_votes/.test(s))).toBe(true);
  });

  it('deletes the vote row for value 0 (neutral)', async () => {
    setup({});
    const res = fakeRes();
    await votesHandler(
      fakeReq({ body: { trip_id: 'trip1', trip_activity_id: 'ta1', value: 0 } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /DELETE FROM trip_votes/.test(s))).toBe(true);
  });

  it('404s when the candidate is not on the trip', async () => {
    setup({ taOnTrip: false });
    const res = fakeRes();
    await votesHandler(
      fakeReq({ body: { trip_id: 'trip1', trip_activity_id: 'ta1', value: 1 } }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('400s on an invalid value', async () => {
    setup({});
    const res = fakeRes();
    await votesHandler(
      fakeReq({ body: { trip_id: 'trip1', trip_activity_id: 'ta1', value: 2 } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/trip-lifecycle?to=planning', () => {
  it('409s when the trip is not in voting', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const res = fakeRes();
    await lifecycleHandler(
      fakeReq({
        query: { id: 'trip1', to: 'planning' },
        body: { kept_activity_ids: [] },
      }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect((res.body as { code?: string }).code).toBe('not_voting');
  });

  it('403s when caller is a member but not the creator', async () => {
    setup({ trip: tripRow({ creator_email: 'someone@else.com' }) });
    const res = fakeRes();
    await lifecycleHandler(
      fakeReq({
        query: { id: 'trip1', to: 'planning' },
        body: { kept_activity_ids: [] },
      }),
      res,
    );
    expect(res.statusCode).toBe(403);
  });

  it('culls unselected candidates + their votes and flips status in one batch', async () => {
    setup({ activities: [{ id: 'a' }, { id: 'b' }] });
    const res = fakeRes();
    await lifecycleHandler(
      fakeReq({
        query: { id: 'trip1', to: 'planning' },
        body: { kept_activity_ids: ['a'] },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const sqls = batchStmtSqls();
    // 'b' is culled: its votes and the row are deleted.
    expect(sqls.some((s) => /DELETE FROM trip_votes/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM trip_activities/.test(s))).toBe(true);
    // 'a' survives with a normalized display_order, and status flips.
    expect(sqls.some((s) => /UPDATE trip_activities SET display_order/.test(s))).toBe(
      true,
    );
    expect(sqls.some((s) => /UPDATE trips SET status = 'planning'/.test(s))).toBe(
      true,
    );
  });
});

describe('POST /api/trip-lifecycle?to=voting', () => {
  it('409s when the trip is not in planning (e.g. still voting)', async () => {
    setup({ trip: tripRow({ status: 'voting' }) });
    const res = fakeRes();
    await lifecycleHandler(fakeReq({ query: { id: 'trip1', to: 'voting' } }), res);
    expect(res.statusCode).toBe(409);
    expect((res.body as { code?: string }).code).toBe('not_planning');
  });

  it('409s on a past trip', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const res = fakeRes();
    await lifecycleHandler(fakeReq({ query: { id: 'trip1', to: 'voting' } }), res);
    expect(res.statusCode).toBe(409);
  });

  it('clears slot fields and flips to voting WITHOUT touching votes', async () => {
    setup({ trip: tripRow({ status: 'planning' }), activities: [{ id: 'a' }] });
    const res = fakeRes();
    await lifecycleHandler(fakeReq({ query: { id: 'trip1', to: 'voting' } }), res);
    expect(res.statusCode).toBe(200);
    const sqls = batchStmtSqls();
    expect(
      sqls.some((s) =>
        /UPDATE trip_activities\s+SET day_index = NULL, start_time = NULL/.test(s),
      ),
    ).toBe(true);
    expect(sqls.some((s) => /UPDATE trips SET status = 'voting'/.test(s))).toBe(
      true,
    );
    // Votes are preserved on revert.
    expect(sqls.some((s) => /DELETE FROM trip_votes/.test(s))).toBe(false);
  });
});

describe('POST /api/trip-lifecycle?to=past (mark past) + dispatch', () => {
  it('flips an active trip to past', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const res = fakeRes();
    await lifecycleHandler(
      fakeReq({
        query: { id: 'trip1', to: 'past' },
        body: { completed_activity_ids: [] },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { marked_past_at?: number }).marked_past_at).toBeTruthy();
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /UPDATE trips\s+SET status = 'past'/.test(s))).toBe(
      true,
    );
  });

  it('409s when the trip is already past', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const res = fakeRes();
    await lifecycleHandler(
      fakeReq({
        query: { id: 'trip1', to: 'past' },
        body: { completed_activity_ids: [] },
      }),
      res,
    );
    expect(res.statusCode).toBe(409);
  });

  it('400s on an unknown ?to value', async () => {
    setup({});
    const res = fakeRes();
    await lifecycleHandler(
      fakeReq({ query: { id: 'trip1', to: 'sideways' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});
