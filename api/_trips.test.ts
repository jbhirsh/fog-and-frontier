import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module eval
// ---------------------------------------------------------------------------

const { verifyToken, getUser } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@clerk/backend', () => ({
  verifyToken,
  createClerkClient: () => ({ users: { getUser } }),
}));

vi.mock('./_db.js', () => ({ db: () => ({ execute, batch: vi.fn() }) }));

// ---------------------------------------------------------------------------
// Environment — set before the module is imported so the module-level Set sees
// the right values (mirrors the pattern in _auth.test.ts)
// ---------------------------------------------------------------------------
process.env.CLERK_SECRET_KEY = 'sk_test_dummy';
process.env.OWNER_EMAILS = 'owner@example.com,owner2@example.com';

const { requireMember, requireCreator } = await import('./_trips.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeReq(auth?: string): VercelRequest {
  return {
    headers: auth ? { authorization: auth } : {},
  } as unknown as VercelRequest;
}

type CapturingRes = VercelResponse & {
  statusCode: number;
  body: unknown;
};

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

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-abc-123';
const CREATOR_EMAIL = 'owner@example.com';
const EDITOR_EMAIL = 'editor@example.com';

const tripRow = {
  id: TRIP_ID,
  creator_email: CREATOR_EMAIL,
  title: 'Test Trip',
  description: null,
  start_date: '2025-07-01',
  end_date: '2025-07-10',
  cover_image_url: null,
  status: 'planning',
  created_at: 1700000000000,
  marked_past_at: null,
};

// ---------------------------------------------------------------------------
// execute() call ordering inside requireMember:
//   - For an OWNER caller, getCurrentUser upserts a users row first, so the
//     order is: [users upsert, getTripRow, isTripMember].
//   - For a NON-OWNER caller, getCurrentUser does not write (#51 c4), so the
//     order is just: [getTripRow, isTripMember].
// ---------------------------------------------------------------------------

describe('requireMember', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('returns 401 and null for an anonymous caller', async () => {
    const res = fakeRes();
    const result = await requireMember(fakeReq(), res, TRIP_ID);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    // No db calls — getCurrentUser short-circuits before the upsert
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns context with isCreator:true when the creator calls their own trip', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_owner' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_owner',
      emailAddresses: [{ id: 'eid_owner', emailAddress: CREATOR_EMAIL }],
    });
    // call 1: upsert users
    execute.mockResolvedValueOnce({ rows: [] });
    // call 2: getTripRow
    execute.mockResolvedValueOnce({ rows: [tripRow] });
    // call 3: isTripMember → member
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toEqual({
      email: CREATOR_EMAIL,
      role: 'owner',
      isCreator: true,
    });
    expect(res.statusCode).toBe(0); // no response written
  });

  it('returns context with isCreator:false when a non-creator member calls', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_editor' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_editor',
      emailAddresses: [{ id: 'eid_editor', emailAddress: EDITOR_EMAIL }],
    });
    // Non-owner: getCurrentUser does NOT upsert, so the first execute() is
    // getTripRow.
    // call 1: getTripRow
    execute.mockResolvedValueOnce({ rows: [tripRow] });
    // call 2: isTripMember → member
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toEqual({
      email: EDITOR_EMAIL,
      role: 'editor',
      isCreator: false,
    });
    expect(res.statusCode).toBe(0);
  });

  it('returns 404 and null when the authenticated user is not a trip member', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_outsider' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_out',
      emailAddresses: [{ id: 'eid_out', emailAddress: 'outsider@example.com' }],
    });
    // Non-owner: no upsert. call 1: getTripRow → trip exists
    execute.mockResolvedValueOnce({ rows: [tripRow] });
    // call 2: isTripMember → not a member
    execute.mockResolvedValueOnce({ rows: [] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('returns 404 and null when the trip does not exist', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_owner' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_owner',
      emailAddresses: [{ id: 'eid_owner', emailAddress: CREATOR_EMAIL }],
    });
    // call 1: upsert users
    execute.mockResolvedValueOnce({ rows: [] });
    // call 2: getTripRow → no trip
    execute.mockResolvedValueOnce({ rows: [] });
    // call 3: isTripMember (still runs even when trip is missing)
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });
});

describe('requireCreator', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('returns 403 and null when the caller is a member but not the creator', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_editor' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_editor',
      emailAddresses: [{ id: 'eid_editor', emailAddress: EDITOR_EMAIL }],
    });
    // Non-owner: no upsert.
    execute.mockResolvedValueOnce({ rows: [tripRow] }); // getTripRow
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // isTripMember → member

    const res = fakeRes();
    const result = await requireCreator(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('returns context when the caller is the creator', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_owner' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_owner',
      emailAddresses: [{ id: 'eid_owner', emailAddress: CREATOR_EMAIL }],
    });
    execute.mockResolvedValueOnce({ rows: [] }); // upsert users
    execute.mockResolvedValueOnce({ rows: [tripRow] }); // getTripRow
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // isTripMember → member

    const res = fakeRes();
    const result = await requireCreator(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toEqual({
      email: CREATOR_EMAIL,
      role: 'owner',
      isCreator: true,
    });
    expect(res.statusCode).toBe(0);
  });

  it('returns 401 and null for an anonymous caller (propagated from requireMember)', async () => {
    const res = fakeRes();
    const result = await requireCreator(fakeReq(), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });
});
