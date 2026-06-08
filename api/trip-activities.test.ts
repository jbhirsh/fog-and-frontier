import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Authorization tests for adding a candidate (#51): only a signed-in member of
// the trip may POST to /api/trip-activities; a signed-in non-member gets 404
// (existence hidden), anon gets 401. SQL-routing mock, same approach as
// trip-voting.test.ts.

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

const handler = (await import('./trip-activities.js')).default;

const OWNER = 'owner@example.com';
const EDITOR = 'editor@example.com';

let state: { trip: Record<string, unknown> | null; isMember: boolean };

function routeExecute(q: unknown) {
  const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
  if (/FROM trips WHERE id/.test(sql)) {
    return { rows: state.trip ? [state.trip] : [] };
  }
  if (/FROM trip_members WHERE trip_id/.test(sql)) {
    return { rows: state.isMember ? [{ '1': 1 }] : [] };
  }
  if (/SELECT id FROM trip_activities WHERE trip_id = \? AND activity_id/.test(sql)) {
    return { rows: [] }; // not a duplicate
  }
  if (/SELECT j FROM a WHERE id/.test(sql)) {
    return { rows: [{ j: JSON.stringify({ id: 'act1', name: 'X' }) }] };
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

function signInAs(emailAddress: string | null) {
  if (!emailAddress) {
    verifyToken.mockReset();
    return;
  }
  verifyToken.mockResolvedValue({ sub: 'u-' + emailAddress });
  getUser.mockResolvedValue({
    primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress }],
  });
}

function fakeReq(opts: { body?: unknown; auth?: boolean }): VercelRequest {
  return {
    method: 'POST',
    query: {},
    body: opts.body,
    headers: opts.auth === false ? {} : { authorization: 'Bearer tok' },
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

afterEach(() => {
  verifyToken.mockReset();
  getUser.mockReset();
  execute.mockReset();
  batch.mockReset();
});

function setup(opts: { as: string | null; isMember: boolean }) {
  state = { trip: tripRow(), isMember: opts.isMember };
  signInAs(opts.as);
  execute.mockImplementation((q: unknown) => Promise.resolve(routeExecute(q)));
  batch.mockResolvedValue([]);
}

describe('POST /api/trip-activities (add candidate) authorization', () => {
  it('lets a trip member (e.g. an invited editor) add a candidate', async () => {
    setup({ as: EDITOR, isMember: true });
    const res = fakeRes();
    await handler(
      fakeReq({ body: { trip_id: 'trip1', activity_id: 'act1' } }),
      res,
    );
    expect(res.statusCode).toBe(201);
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /INSERT INTO trip_activities/.test(s))).toBe(true);
  });

  it('404s for a signed-in NON-member (existence hidden — cannot add)', async () => {
    setup({ as: EDITOR, isMember: false });
    const res = fakeRes();
    await handler(
      fakeReq({ body: { trip_id: 'trip1', activity_id: 'act1' } }),
      res,
    );
    expect(res.statusCode).toBe(404);
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    // No write happened.
    expect(sqls.some((s) => /INSERT INTO trip_activities/.test(s))).toBe(false);
  });

  it('401s for an anonymous caller', async () => {
    setup({ as: null, isMember: false });
    const res = fakeRes();
    await handler(
      fakeReq({ body: { trip_id: 'trip1', activity_id: 'act1' }, auth: false }),
      res,
    );
    expect(res.statusCode).toBe(401);
  });
});
