import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from './_auth.js';

// Token → caller resolution. The GraphQL context (api/_gqlContext.ts) pulls the
// Bearer token off the request and hands it to these functions; its guards
// turn the result into UNAUTHENTICATED / FORBIDDEN (see _gqlContext.test.ts).

const { verifyToken, getUser, createClerkClient } = vi.hoisted(() => {
  const getUser = vi.fn();
  return {
    verifyToken: vi.fn(),
    getUser,
    createClerkClient: vi.fn(() => ({ users: { getUser } })),
  };
});

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@clerk/backend', () => ({ verifyToken, createClerkClient }));

vi.mock('./_db.js', () => ({ db: () => ({ execute, batch: vi.fn() }) }));

process.env.CLERK_SECRET_KEY = 'sk_test_dummy';
process.env.OWNER_EMAILS = 'owner@example.com,owner2@example.com';

const { getCallerStatusFromToken, getCurrentUserFromToken } = await import(
  './_auth.js'
);

describe('getCallerStatusFromToken', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('is anonymous when there is no token', async () => {
    expect(await getCallerStatusFromToken(null)).toEqual({ state: 'anon' });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('is anonymous when the token is invalid', async () => {
    verifyToken.mockRejectedValueOnce(new Error('bad token'));
    expect(await getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
  });

  it('is anonymous when the payload is missing sub', async () => {
    verifyToken.mockResolvedValueOnce({});
    expect(await getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('is a non-owner (not anonymous) when the token is valid but the email is not an owner', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'rando@example.com' }],
    });
    expect(await getCallerStatusFromToken('xxx')).toEqual({
      state: 'non_owner',
      email: 'rando@example.com',
    });
  });

  it('is the owner (email lowercased) when the token is valid and the email matches an owner', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'Owner@Example.com' }],
    });
    expect(await getCallerStatusFromToken('xxx')).toEqual({
      state: 'owner',
      email: 'owner@example.com',
    });
  });

  it('treats an empty token as no token', async () => {
    expect(await getCallerStatusFromToken('')).toEqual({ state: 'anon' });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('is anonymous when Clerk getUser throws (e.g. outage)', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockRejectedValueOnce(new Error('clerk 503'));
    expect(await getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
  });

  it('is anonymous when the user has no primary email address', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: null,
      emailAddresses: [{ id: 'eid_1', emailAddress: 'owner@example.com' }],
    });
    expect(await getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
  });

  it('trims whitespace around the user email before comparison', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: '  Owner@Example.com  ' }],
    });
    expect(await getCallerStatusFromToken('xxx')).toEqual({
      state: 'owner',
      email: 'owner@example.com',
    });
  });
});

describe('getCurrentUserFromToken', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('returns null for anonymous caller and does not call db upsert', async () => {
    const result = await getCurrentUserFromToken(null);
    expect(result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns { email, role: "owner" } for an owner email and calls db upsert with role "owner"', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'Owner@Example.com' }],
    });
    execute.mockResolvedValueOnce({ rows: [] });

    const result = await getCurrentUserFromToken('xxx');
    expect(result).toEqual({ email: 'owner@example.com', role: 'owner' });
    expect(execute).toHaveBeenCalledOnce();
    const callArg = execute.mock.calls[0]?.[0] as { sql: string; args: unknown[] };
    expect(callArg.sql).toContain("'owner'");
    expect(callArg.args).toContain('owner@example.com');
  });

  it('returns { email, role: "editor" } for a non-owner email and does NOT write a users row', async () => {
    // Non-owner rows are created only at invite-claim time (#51 c4), so a
    // plain editor sign-in must not seed a users row here.
    verifyToken.mockResolvedValueOnce({ sub: 'user_456' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_2',
      emailAddresses: [{ id: 'eid_2', emailAddress: 'editor@example.com' }],
    });

    const result = await getCurrentUserFromToken('yyy');
    expect(result).toEqual({ email: 'editor@example.com', role: 'editor' });
    expect(execute).not.toHaveBeenCalled();
  });
});

// _auth.ts reads CLERK_SECRET_KEY / OWNER_EMAILS once at module load, so a
// different configuration needs a fresh copy of the module.
async function freshAuth(env: {
  CLERK_SECRET_KEY?: string;
  OWNER_EMAILS?: string;
}): Promise<typeof AuthModule> {
  vi.resetModules();
  vi.stubEnv('CLERK_SECRET_KEY', env.CLERK_SECRET_KEY);
  vi.stubEnv('OWNER_EMAILS', env.OWNER_EMAILS);
  try {
    return await import('./_auth.js');
  } finally {
    vi.unstubAllEnvs();
  }
}

function signInAs(email: string) {
  verifyToken.mockResolvedValue({ sub: 'user_123' });
  getUser.mockResolvedValue({
    primaryEmailAddressId: 'eid_1',
    emailAddresses: [{ id: 'eid_1', emailAddress: email }],
  });
}

describe('owner gate: token verification', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('verifies the token against the configured Clerk secret key', async () => {
    signInAs('owner@example.com');
    expect(await getCallerStatusFromToken('xxx')).toEqual({
      state: 'owner',
      email: 'owner@example.com',
    });
    expect(verifyToken).toHaveBeenCalledWith('xxx', { secretKey: 'sk_test_dummy' });
  });

  it('an unverifiable token stays anonymous even if Clerk would resolve an owner', async () => {
    signInAs('owner@example.com');
    verifyToken.mockReset();
    verifyToken.mockRejectedValue(new Error('bad signature'));
    expect(await getCallerStatusFromToken('forged')).toEqual({ state: 'anon' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('no primary email → anonymous, not a signed-in non-owner', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_123' });
    getUser.mockResolvedValue({
      primaryEmailAddressId: null,
      emailAddresses: [{ id: 'eid_1', emailAddress: 'owner@example.com' }],
    });
    expect(await getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
  });
});

describe('getCurrentUserFromToken: every unverified caller is anonymous', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('token payload without a sub → null', async () => {
    verifyToken.mockResolvedValue({});
    expect(await getCurrentUserFromToken('xxx')).toBeNull();
  });

  it('token that fails verification → null', async () => {
    verifyToken.mockRejectedValue(new Error('bad token'));
    expect(await getCurrentUserFromToken('xxx')).toBeNull();
  });

  it('Clerk user lookup failure → null', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_123' });
    getUser.mockRejectedValue(new Error('clerk 503'));
    expect(await getCurrentUserFromToken('xxx')).toBeNull();
  });

  it('user with no primary email → null', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_123' });
    getUser.mockResolvedValue({ primaryEmailAddressId: null, emailAddresses: [] });
    expect(await getCurrentUserFromToken('xxx')).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('owner gate: configuration', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('without CLERK_SECRET_KEY nobody is an owner, and no token is verified', async () => {
    const auth = await freshAuth({ OWNER_EMAILS: 'owner@example.com' });
    signInAs('owner@example.com');
    expect(await auth.getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('with no owner emails configured (blank entries only) every caller is anonymous', async () => {
    const auth = await freshAuth({ CLERK_SECRET_KEY: 'sk_test_dummy', OWNER_EMAILS: ' , ,' });
    signInAs('owner@example.com');
    expect(await auth.getCallerStatusFromToken('xxx')).toEqual({ state: 'anon' });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('OWNER_EMAILS entries are trimmed and case-insensitive', async () => {
    const auth = await freshAuth({
      CLERK_SECRET_KEY: 'sk_test_dummy',
      OWNER_EMAILS: ' First@Example.com , second@example.com ',
    });
    signInAs('second@example.com');
    expect(await auth.getCallerStatusFromToken('xxx')).toEqual({
      state: 'owner',
      email: 'second@example.com',
    });
    signInAs('first@example.com');
    expect(await auth.getCallerStatusFromToken('xxx')).toEqual({
      state: 'owner',
      email: 'first@example.com',
    });
  });

  it('builds one Clerk client, with the secret key, and reuses it', async () => {
    const auth = await freshAuth({
      CLERK_SECRET_KEY: 'sk_test_dummy',
      OWNER_EMAILS: 'owner@example.com',
    });
    createClerkClient.mockClear();
    signInAs('owner@example.com');
    await auth.getCallerStatusFromToken('xxx');
    await auth.getCallerStatusFromToken('xxx');
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(createClerkClient).toHaveBeenCalledTimes(1);
    expect(createClerkClient).toHaveBeenCalledWith({ secretKey: 'sk_test_dummy' });
  });
});

describe('getOwnerEmails', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads OWNER_EMAILS at call time: trimmed, lowercased, blanks dropped', async () => {
    const { getOwnerEmails } = await import('./_auth.js');
    vi.stubEnv('OWNER_EMAILS', ' A@X.com, b@y.com ,, ');
    expect(getOwnerEmails()).toEqual(new Set(['a@x.com', 'b@y.com']));
  });

  it('is empty when OWNER_EMAILS is unset', async () => {
    const { getOwnerEmails } = await import('./_auth.js');
    vi.stubEnv('OWNER_EMAILS', undefined);
    expect(getOwnerEmails()).toEqual(new Set());
  });
});
