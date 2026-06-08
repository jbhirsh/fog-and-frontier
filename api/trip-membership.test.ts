import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint tests for the membership/invite lifecycle (#51 PR3): trip-members,
// invites, invite-claim — all via the consolidated trip-membership handler. Same SQL-routing mock approach as
// trip-voting.test.ts — route db().execute by SQL substring so ensureTripsSchema
// doesn't need per-call sequencing. trip_members lookups are routed by the
// member_email arg so caller-vs-target membership can differ.

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

// members + invites + invite-claim are consolidated into a single
// trip-membership function (dispatch by method + params) to stay under Vercel's
// per-deployment function cap. These aliases keep the test cases readable.
const membershipHandler = (await import('./trip-membership.js')).default;
const membersHandler = membershipHandler;
const invitesHandler = membershipHandler;
const claimHandler = membershipHandler;

const OWNER = 'owner@example.com';
const EDITOR = 'editor@example.com';

type State = {
  trip: Record<string, unknown> | null;
  members: Set<string>;
  invite: Record<string, unknown> | null;
};
let state: State;

function routeExecute(q: unknown) {
  const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
  const args =
    typeof q === 'string' ? [] : ((q as { args?: unknown[] }).args ?? []);
  if (/FROM trip_invites WHERE invite_token/.test(sql)) {
    return { rows: state.invite ? [state.invite] : [] };
  }
  if (/FROM trips WHERE id/.test(sql)) {
    return { rows: state.trip ? [state.trip] : [] };
  }
  if (/SELECT 1 FROM trip_members WHERE trip_id = \? AND member_email/.test(sql)) {
    const email = typeof args[1] === 'string' ? args[1] : '';
    return { rows: state.members.has(email) ? [{ '1': 1 }] : [] };
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

function signInAs(emailAddress: string) {
  verifyToken.mockResolvedValue({ sub: 'u-' + emailAddress });
  getUser.mockResolvedValue({
    primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress }],
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

function executedSqls(): string[] {
  return execute.mock.calls.map((c) =>
    typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
  );
}

afterEach(() => {
  verifyToken.mockReset();
  getUser.mockReset();
  execute.mockReset();
  batch.mockReset();
});

function setup(partial: Partial<State> & { as?: string }) {
  state = {
    trip: tripRow(),
    members: new Set([OWNER]),
    invite: null,
    ...partial,
  };
  signInAs(partial.as ?? OWNER);
  execute.mockImplementation((q: unknown) => Promise.resolve(routeExecute(q)));
  batch.mockResolvedValue([]);
}

describe('POST /api/trip-membership (invite)', () => {
  it('creates a pending invite for a new email', async () => {
    setup({});
    const res = fakeRes();
    await membersHandler(
      fakeReq({ query: { id: 'trip1' }, body: { email: 'new@example.com' } }),
      res,
    );
    expect(res.statusCode).toBe(201);
    expect((res.body as { invite_token?: string }).invite_token).toBeTruthy();
    expect(executedSqls().some((s) => /INSERT INTO trip_invites/.test(s))).toBe(
      true,
    );
  });

  it('409s when the email is already a member', async () => {
    setup({ members: new Set([OWNER, 'dup@example.com']) });
    const res = fakeRes();
    await membersHandler(
      fakeReq({ query: { id: 'trip1' }, body: { email: 'dup@example.com' } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect((res.body as { code?: string }).code).toBe('already_member');
  });

  it('400s on an invalid email', async () => {
    setup({});
    const res = fakeRes();
    await membersHandler(
      fakeReq({ query: { id: 'trip1' }, body: { email: 'not-an-email' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/trip-membership (remove / leave)', () => {
  it('lets the creator remove another member', async () => {
    setup({ members: new Set([OWNER, 'other@example.com']) });
    const res = fakeRes();
    await membersHandler(
      fakeReq({
        method: 'DELETE',
        query: { id: 'trip1', email: 'other@example.com' },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(
      executedSqls().some((s) => /DELETE FROM trip_members/.test(s)),
    ).toBe(true);
  });

  it('403s when a non-creator member removes someone else', async () => {
    setup({ as: EDITOR, members: new Set([OWNER, EDITOR, 'other@example.com']) });
    const res = fakeRes();
    await membersHandler(
      fakeReq({
        method: 'DELETE',
        query: { id: 'trip1', email: 'other@example.com' },
      }),
      res,
    );
    expect(res.statusCode).toBe(403);
  });

  it('409s when the creator tries to leave their own trip', async () => {
    setup({ members: new Set([OWNER]) });
    const res = fakeRes();
    await membersHandler(
      fakeReq({ method: 'DELETE', query: { id: 'trip1', email: OWNER } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect((res.body as { code?: string }).code).toBe('creator_cannot_leave');
  });

  it('lets a non-creator member leave (self-removal)', async () => {
    setup({ as: EDITOR, members: new Set([OWNER, EDITOR]) });
    const res = fakeRes();
    await membersHandler(
      fakeReq({ method: 'DELETE', query: { id: 'trip1', email: EDITOR } }),
      res,
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/trip-membership (claim)', () => {
  const invite = {
    trip_id: 'trip1',
    invite_token: 'tok',
    invited_email: 'invited@example.com',
    invited_by_email: OWNER,
    invited_at: 1,
  };

  it('adds the claimer as a member and returns the trip id', async () => {
    setup({ as: EDITOR, members: new Set([OWNER]), invite });
    const res = fakeRes();
    await claimHandler(fakeReq({ body: { invite_token: 'tok' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { trip_id?: string }).trip_id).toBe('trip1');
    const sqls = executedSqls();
    expect(sqls.some((s) => /INSERT OR IGNORE INTO trip_members/.test(s))).toBe(
      true,
    );
    expect(sqls.some((s) => /DELETE FROM trip_invites/.test(s))).toBe(true);
  });

  it('404s on an invalid/used token', async () => {
    setup({ as: EDITOR, invite: null });
    const res = fakeRes();
    await claimHandler(fakeReq({ body: { invite_token: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
    expect((res.body as { code?: string }).code).toBe('invite_invalid');
  });

  it('is idempotent when the caller is already a member', async () => {
    setup({ as: EDITOR, members: new Set([OWNER, EDITOR]), invite });
    const res = fakeRes();
    await claimHandler(fakeReq({ body: { invite_token: 'tok' } }), res);
    expect(res.statusCode).toBe(200);
    const sqls = executedSqls();
    // Consumes the dangling invite but does not re-add the member.
    expect(sqls.some((s) => /DELETE FROM trip_invites/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT OR IGNORE INTO trip_members/.test(s))).toBe(
      false,
    );
  });
});

describe('DELETE /api/trip-membership (revoke)', () => {
  it('lets a member revoke a pending invite', async () => {
    setup({ members: new Set([OWNER]) });
    const res = fakeRes();
    await invitesHandler(
      fakeReq({ method: 'DELETE', query: { id: 'trip1', token: 'tok' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(executedSqls().some((s) => /DELETE FROM trip_invites/.test(s))).toBe(
      true,
    );
  });
});
