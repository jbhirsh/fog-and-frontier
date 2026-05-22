import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const { verifyToken, getUser } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@clerk/backend', () => ({
  verifyToken,
  createClerkClient: () => ({ users: { getUser } }),
}));

process.env.CLERK_SECRET_KEY = 'sk_test_dummy';
process.env.OWNER_EMAILS = 'owner@example.com,owner2@example.com';

const { getOwnerEmail, requireOwner } = await import('./_auth.js');

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

describe('api/_auth', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
  });

  it('returns null when no Authorization header', async () => {
    expect(await getOwnerEmail(fakeReq())).toBeNull();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('returns null when token is invalid', async () => {
    verifyToken.mockRejectedValueOnce(new Error('bad token'));
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBeNull();
  });

  it('returns null when payload is missing sub', async () => {
    verifyToken.mockResolvedValueOnce({});
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns null when token is valid but email is not an owner', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'rando@example.com' }],
    });
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBeNull();
  });

  it('returns email (lowercased) when token is valid and email matches an owner', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'Owner@Example.com' }],
    });
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBe('owner@example.com');
  });

  it('requireOwner writes 401 and returns null when no token', async () => {
    const res = fakeRes();
    const result = await requireOwner(fakeReq(), res);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('requireOwner writes 403 (not 401) when caller is signed in but not an owner', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'rando@example.com' }],
    });
    const res = fakeRes();
    const result = await requireOwner(fakeReq('Bearer xxx'), res);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('requireOwner returns email when caller is an owner', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: 'owner@example.com' }],
    });
    const res = fakeRes();
    const result = await requireOwner(fakeReq('Bearer xxx'), res);
    expect(result).toBe('owner@example.com');
    expect(res.statusCode).toBe(0);
  });

  it('returns null when Authorization is "Bearer " with no token', async () => {
    expect(await getOwnerEmail(fakeReq('Bearer '))).toBeNull();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('returns null when Clerk getUser throws (e.g. outage)', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockRejectedValueOnce(new Error('clerk 503'));
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBeNull();
  });

  it('returns null when user has no primary email address', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: null,
      emailAddresses: [{ id: 'eid_1', emailAddress: 'owner@example.com' }],
    });
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBeNull();
  });

  it('trims whitespace around the user email before comparison', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_1',
      emailAddresses: [{ id: 'eid_1', emailAddress: '  Owner@Example.com  ' }],
    });
    expect(await getOwnerEmail(fakeReq('Bearer xxx'))).toBe('owner@example.com');
  });
});
