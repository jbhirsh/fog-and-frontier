import { beforeEach, describe, expect, it, vi } from 'vitest';

// Who a signed-in caller is to the app (callerFromSession), and the `users`
// row each sign-in keeps in step (syncUserRow). The session itself comes
// from Better Auth (_betterAuth.test.ts); the database is mocked here.

type Stmt = { sql: string; args: unknown[] };
const { execute } = vi.hoisted(() => ({
  execute: vi.fn<(stmt: Stmt) => Promise<{ rows: unknown[]; rowsAffected: number }>>(),
}));
vi.mock('./_db.js', () => ({ db: () => ({ execute }) }));

process.env.OWNER_EMAILS = 'Owner@Example.com, second@example.com';
const { callerFromSession, getOwnerEmails, syncUserRow } = await import('./_auth.js');

const session = (email: string, { name = 'Jess', emailVerified = true } = {}) => ({
  user: { email, name, emailVerified },
});

const calls = () => execute.mock.calls.map(([s]) => s);

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
});

describe('callerFromSession', () => {
  it('is no one for a signed-out caller', () => {
    expect(callerFromSession(null)).toBeNull();
  });

  it('is an owner whose email is in OWNER_EMAILS, however it is cased or spaced', () => {
    expect(callerFromSession(session('  OWNER@example.com '))).toEqual({
      email: 'owner@example.com',
      role: 'owner',
      firstName: 'Jess',
    });
  });

  it('is an editor otherwise: any other verified account', () => {
    expect(callerFromSession(session('friend@example.com'))?.role).toBe('editor');
  });

  it('is no one with an unverified email, which proves no identity', () => {
    expect(callerFromSession(session('owner@example.com', { emailVerified: false }))).toBeNull();
  });

  it('is no one with an empty email', () => {
    expect(callerFromSession(session('   '))).toBeNull();
  });

  it('takes the account’s first name, trimmed and capped, or none', () => {
    expect(callerFromSession(session('owner@example.com', { name: '  Tarun ' }))?.firstName).toBe(
      'Tarun',
    );
    expect(
      callerFromSession(session('owner@example.com', { name: 'x'.repeat(80) }))?.firstName,
    ).toHaveLength(50);
    expect(callerFromSession(session('owner@example.com', { name: '' }))?.firstName).toBeNull();
  });
});

describe('getOwnerEmails', () => {
  it('reads OWNER_EMAILS as it is now, lowercased', () => {
    expect([...getOwnerEmails()]).toEqual(['owner@example.com', 'second@example.com']);
  });
});

describe('syncUserRow', () => {
  it('upserts an owner’s row, role and name, keeping a stored name when none is given', async () => {
    await syncUserRow(' Owner@Example.com', 'Jess');
    const [stmt] = calls();
    expect(stmt.sql).toContain('INSERT INTO users');
    expect(stmt.sql).toContain("role = 'owner'");
    expect(stmt.sql).toContain('COALESCE(excluded.display_name, users.display_name)');
    expect(stmt.args.slice(0, 2)).toEqual(['owner@example.com', 'Jess']);

    execute.mockClear();
    await syncUserRow('owner@example.com', null);
    expect(calls()[0].args[1]).toBeNull();
  });

  it('gives an editor’s existing row their name, and never makes a new row', async () => {
    await syncUserRow('Friend@example.com', 'Sam');
    expect(calls()).toEqual([
      {
        sql: 'UPDATE users SET display_name = ? WHERE email = ?',
        args: ['Sam', 'friend@example.com'],
      },
    ]);
  });

  it('writes nothing for an editor with no name', async () => {
    await syncUserRow('friend@example.com', '  ');
    expect(execute).not.toHaveBeenCalled();
  });
});
