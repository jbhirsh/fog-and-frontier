import { db } from './_db.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// Who a signed-in caller is to the app. Better Auth (_betterAuth.ts) says who
// signed in; this says what they may do (owner or editor) and keeps their
// `users` row, which the invite picker and every attribution read, in step.

const ownerEmails = new Set(
  (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

// Read OWNER_EMAILS lazily as well so callers (e.g. the trips backfill) that
// run after a late env injection still see the configured owners. The module
// `ownerEmails` set above is sufficient for the hot path; this getter exists
// for code outside this module that needs the list.
export function getOwnerEmails(): Set<string> {
  return new Set(
    (process.env.OWNER_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Editor accounts (#51). Owners come from OWNER_EMAILS; editors are created on
// first sign-in once they hold trip membership. Role is always derived from the
// owner allow-list at auth time — the `users.role` column is a cache of that.
export type UserRole = 'owner' | 'editor';

export type CurrentUser = {
  email: string;
  role: UserRole;
  /** The account's first name, for the `users` row a claimed invite creates. */
  firstName?: string | null;
};

/** The part of a Better Auth session this reads. */
export type SessionLike = {
  user: { email: string; name?: string | null; emailVerified: boolean };
} | null;

// The account's first name (Google's given name, set as the account's name
// at sign-in), for showing people as "Tarun" rather than their email. Null
// when there is none.
function firstNameOf(name: string | null | undefined): string | null {
  const first = typeof name === 'string' ? name.trim() : '';
  return first ? first.slice(0, 50) : null;
}

/**
 * The caller a session belongs to, or null for a signed-out one. An email
 * that isn't verified is no identity to trust, and with no owners configured
 * nobody is signed in (a misconfigured deployment stays read-only). The
 * GraphQL guards in api/_gqlContext.ts build on this: `requireOwnerCtx`
 * remains the gate for site-wide writes and paid endpoints.
 */
export function callerFromSession(session: SessionLike): CurrentUser | null {
  if (!session || ownerEmails.size === 0) return null;
  if (!session.user.emailVerified) return null;
  const email = session.user.email.trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    role: ownerEmails.has(email) ? 'owner' : 'editor',
    firstName: firstNameOf(session.user.name),
  };
}

/**
 * Brings an account's `users` row up to date when it signs in. Callers MUST
 * have run `ensureAllSchemas()` first (it creates the `users` table).
 *
 * Only owners get a `users` row written here. A non-owner row is created
 * exactly when that account claims a trip invite or has a suggestion
 * accepted. Writing one for *every* signed-in visitor would let any random
 * Google sign-in seed a row and pollute the global invite-picker
 * autocomplete (#51 c4), which is meant to list owners + invitees only. The
 * owner upsert also keeps `role` correct if an editor is later promoted into
 * OWNER_EMAILS. Either way the row takes the account's first name, so people
 * show as "Tarun" rather than their email (a sign-in with no name keeps the
 * one stored).
 */
export async function syncUserRow(rawEmail: string, name: string | null): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const firstName = firstNameOf(name);
  if (ownerEmails.has(email)) {
    await db().execute({
      sql: `INSERT INTO users (email, display_name, created_at, role)
            VALUES (?, ?, ?, 'owner')
            ON CONFLICT(email) DO UPDATE SET
              role = 'owner',
              display_name = COALESCE(excluded.display_name, users.display_name)`,
      args: [email, firstName, Date.now()],
    });
  } else if (firstName) {
    await db().execute({
      sql: 'UPDATE users SET display_name = ? WHERE email = ?',
      args: [firstName, email],
    });
  }
}
