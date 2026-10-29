import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

// Unit tests for the GraphQL context: the session cookie read in buildContext
// and the auth guards (requireUserCtx / requireOwnerCtx / requireMemberCtx /
// requireCreatorCtx / loadTripForMemberOrNull), which are the server-side gate
// for every resolver. Better Auth's session lookup, the session→caller
// mapping and the trip reads are mocked at their module boundaries
// (_betterAuth.test.ts, _auth.test.ts and _trips.test.ts cover them).

const { getSession, callerFromSession, logServerError } = vi.hoisted(() => ({
  getSession: vi.fn(),
  callerFromSession: vi.fn(),
  logServerError: vi.fn(),
}));
const { getTripRow, isTripMember, getTripDetail } = vi.hoisted(() => ({
  getTripRow: vi.fn(),
  isTripMember: vi.fn(),
  getTripDetail: vi.fn(),
}));

vi.mock('./_betterAuth.js', () => ({ auth: () => ({ api: { getSession } }) }));
vi.mock('./_auth.js', () => ({ callerFromSession }));
vi.mock('./_log.js', () => ({ logServerError }));
vi.mock('./_trips.js', () => ({ getTripRow, isTripMember, getTripDetail }));

const {
  buildContext,
  hasSessionCookie,
  requireUserCtx,
  requireOwnerCtx,
  requireMemberCtx,
  requireCreatorCtx,
  loadTripForMemberOrNull,
} = await import('./_gqlContext.js');

const OWNER = { email: 'owner@example.com', role: 'owner' as const };
const EDITOR = { email: 'editor@example.com', role: 'editor' as const };
const TRIP_ID = 'trip-abc-123';
// The trip row only needs creator_email for the guards.
const TRIP_BY_OWNER = { id: TRIP_ID, creator_email: OWNER.email };

const COOKIE = '__Secure-better-auth.session_token=abc.def';
const SESSION = { user: { email: OWNER.email, name: 'Jess', emailVerified: true } };

function req(cookie?: string): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as unknown as Request;
}

afterEach(() => {
  getSession.mockReset();
  callerFromSession.mockReset();
  logServerError.mockReset();
  getTripRow.mockReset();
  isTripMember.mockReset();
  getTripDetail.mockReset();
});

describe('hasSessionCookie', () => {
  it.each([
    ['the secure cookie', '__Secure-better-auth.session_token=x', true],
    ['the plain cookie (http, local)', 'better-auth.session_token=x', true],
    ['it among others', 'theme=dark; better-auth.session_token=x; a=b', true],
    ['no cookie header', undefined, false],
    ['other cookies only', 'theme=dark; better-auth.session_data=x', false],
    ['a cookie whose name only ends the same', 'notbetter-auth.session_token=x', false],
  ])('%s → %s', (_label, cookie, expected) => {
    expect(hasSessionCookie(cookie)).toBe(expected);
  });
});

describe('buildContext', () => {
  it('reads the caller from the session the cookie names', async () => {
    getSession.mockResolvedValue(SESSION);
    callerFromSession.mockReturnValue(OWNER);
    expect(await buildContext(req(COOKIE))).toEqual({ caller: OWNER });
    expect(callerFromSession).toHaveBeenCalledWith(SESSION);
    const { headers } = getSession.mock.calls[0]?.[0] as { headers: Headers };
    expect(headers.get('cookie')).toBe(COOKIE);
  });

  it('is signed out, with no lookup, when there is no session cookie', async () => {
    expect(await buildContext(req())).toEqual({ caller: null });
    expect(await buildContext(req('theme=dark'))).toEqual({ caller: null });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('is signed out when the cookie names no live session', async () => {
    getSession.mockResolvedValue(null);
    callerFromSession.mockReturnValue(null);
    expect(await buildContext(req(COOKIE))).toEqual({ caller: null });
  });

  it('is signed out, and says so in the log, when the lookup fails', async () => {
    getSession.mockRejectedValue(new Error('BETTER_AUTH_SECRET not set'));
    expect(await buildContext(req(COOKIE))).toEqual({ caller: null });
    expect(logServerError).toHaveBeenCalledOnce();
  });
});

const UNAUTHENTICATED = { extensions: { code: 'UNAUTHENTICATED' } };
const FORBIDDEN = { extensions: { code: 'FORBIDDEN' } };
const NOT_FOUND = { extensions: { code: 'NOT_FOUND' } };

describe('requireUserCtx', () => {
  it('anon → UNAUTHENTICATED', () => {
    expect(() => requireUserCtx({ caller: null })).toThrow(
      expect.objectContaining(UNAUTHENTICATED),
    );
  });

  it('returns any signed-in caller, owner or editor', () => {
    expect(requireUserCtx({ caller: OWNER })).toBe(OWNER);
    expect(requireUserCtx({ caller: EDITOR })).toBe(EDITOR);
  });
});

describe('requireOwnerCtx', () => {
  it('anon → UNAUTHENTICATED', () => {
    expect(() => requireOwnerCtx({ caller: null })).toThrow(
      expect.objectContaining(UNAUTHENTICATED),
    );
  });

  it('signed-in non-owner → FORBIDDEN (not UNAUTHENTICATED)', () => {
    expect(() => requireOwnerCtx({ caller: EDITOR })).toThrow(expect.objectContaining(FORBIDDEN));
  });

  it('returns the caller when it is the owner', () => {
    expect(requireOwnerCtx({ caller: OWNER })).toBe(OWNER);
  });
});

describe('requireMemberCtx', () => {
  it('anon → UNAUTHENTICATED without reading the trip', async () => {
    await expect(requireMemberCtx({ caller: null }, 'trip1')).rejects.toMatchObject({
      extensions: { code: 'UNAUTHENTICATED' },
    });
    expect(getTripRow).not.toHaveBeenCalled();
    expect(isTripMember).not.toHaveBeenCalled();
  });

  it('returns isCreator:true when the creator calls their own trip', async () => {
    getTripRow.mockResolvedValue(TRIP_BY_OWNER);
    isTripMember.mockResolvedValue(true);
    expect(await requireMemberCtx({ caller: OWNER }, TRIP_ID)).toEqual({
      email: OWNER.email,
      role: 'owner',
      isCreator: true,
    });
    expect(getTripRow).toHaveBeenCalledWith(TRIP_ID);
    expect(isTripMember).toHaveBeenCalledWith(TRIP_ID, OWNER.email);
  });

  it('returns isCreator:false when a non-creator member calls', async () => {
    getTripRow.mockResolvedValue(TRIP_BY_OWNER);
    isTripMember.mockResolvedValue(true);
    expect(await requireMemberCtx({ caller: EDITOR }, TRIP_ID)).toEqual({
      email: EDITOR.email,
      role: 'editor',
      isCreator: false,
    });
    expect(isTripMember).toHaveBeenCalledWith(TRIP_ID, EDITOR.email);
  });

  it('signed-in non-member → NOT_FOUND (existence hidden), not FORBIDDEN', async () => {
    getTripRow.mockResolvedValue(TRIP_BY_OWNER);
    isTripMember.mockResolvedValue(false);
    await expect(requireMemberCtx({ caller: EDITOR }, TRIP_ID)).rejects.toMatchObject(NOT_FOUND);
  });

  it('missing trip → NOT_FOUND even if a membership row exists', async () => {
    getTripRow.mockResolvedValue(null);
    isTripMember.mockResolvedValue(true);
    await expect(requireMemberCtx({ caller: OWNER }, TRIP_ID)).rejects.toMatchObject(NOT_FOUND);
  });
});

describe('requireCreatorCtx', () => {
  it('anon → UNAUTHENTICATED (propagated from requireMemberCtx)', async () => {
    await expect(requireCreatorCtx({ caller: null }, TRIP_ID)).rejects.toMatchObject(
      UNAUTHENTICATED,
    );
  });

  it('signed-in non-member → NOT_FOUND (propagated from requireMemberCtx)', async () => {
    getTripRow.mockResolvedValue(TRIP_BY_OWNER);
    isTripMember.mockResolvedValue(false);
    await expect(requireCreatorCtx({ caller: EDITOR }, TRIP_ID)).rejects.toMatchObject(NOT_FOUND);
  });

  it('member who is not the creator → FORBIDDEN', async () => {
    getTripRow.mockResolvedValue(TRIP_BY_OWNER);
    isTripMember.mockResolvedValue(true);
    await expect(requireCreatorCtx({ caller: EDITOR }, TRIP_ID)).rejects.toMatchObject(FORBIDDEN);
  });

  it('returns the member context when the caller is the creator', async () => {
    getTripRow.mockResolvedValue(TRIP_BY_OWNER);
    isTripMember.mockResolvedValue(true);
    expect(await requireCreatorCtx({ caller: OWNER }, TRIP_ID)).toEqual({
      email: OWNER.email,
      role: 'owner',
      isCreator: true,
    });
  });
});

describe('loadTripForMemberOrNull', () => {
  it('anon → UNAUTHENTICATED without reading the trip', async () => {
    await expect(loadTripForMemberOrNull({ caller: null }, TRIP_ID)).rejects.toMatchObject(
      UNAUTHENTICATED,
    );
    expect(isTripMember).not.toHaveBeenCalled();
    expect(getTripDetail).not.toHaveBeenCalled();
  });

  it('non-member → null without loading the trip (existence hidden)', async () => {
    isTripMember.mockResolvedValue(false);
    expect(await loadTripForMemberOrNull({ caller: EDITOR }, TRIP_ID)).toBeNull();
    expect(isTripMember).toHaveBeenCalledWith(TRIP_ID, EDITOR.email);
    expect(getTripDetail).not.toHaveBeenCalled();
  });

  it('member → the trip detail', async () => {
    const detail = { id: TRIP_ID };
    isTripMember.mockResolvedValue(true);
    getTripDetail.mockResolvedValue(detail);
    expect(await loadTripForMemberOrNull({ caller: EDITOR }, TRIP_ID)).toBe(detail);
    expect(getTripDetail).toHaveBeenCalledWith(TRIP_ID);
  });
});
