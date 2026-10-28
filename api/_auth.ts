import { createClerkClient, verifyToken } from '@clerk/backend';
import { db } from './_db.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.

const secretKey = process.env.CLERK_SECRET_KEY ?? '';
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

let _client: ReturnType<typeof createClerkClient> | null = null;
function client() {
  if (!_client) _client = createClerkClient({ secretKey });
  return _client;
}

// Tri-state caller status so `requireOwnerCtx` (api/_gqlContext.ts) can
// distinguish anon (UNAUTHENTICATED) from signed-in non-owner (FORBIDDEN) per
// #50 AC. Clerk/network failures collapse to `anon` since we can't trust the
// identity — same conservative posture as the prior boolean helper.
export type CallerStatus =
  | { state: 'anon' }
  | { state: 'non_owner'; email: string; firstName: string | null }
  | { state: 'owner'; email: string; firstName: string | null };

// The account's first name as Clerk has it (from Google, or as typed at
// sign-up), for showing people as "Tarun" rather than their email. Null when
// there is none.
function firstNameOf(user: { firstName?: string | null }): string | null {
  const name = typeof user.firstName === 'string' ? user.firstName.trim() : '';
  return name ? name.slice(0, 50) : null;
}

// Token-core: resolve a caller from a raw Bearer token string (no req object).
// The GraphQL context (api/_gqlContext.ts) extracts the token from the request
// and authenticates from it, so the identity logic lives here.
export async function getCallerStatusFromToken(token: string | null): Promise<CallerStatus> {
  if (!secretKey || ownerEmails.size === 0) return { state: 'anon' };
  if (!token) return { state: 'anon' };

  let userId: string;
  try {
    const payload = await verifyToken(token, { secretKey });
    if (typeof payload.sub !== 'string') return { state: 'anon' };
    userId = payload.sub;
  } catch {
    return { state: 'anon' };
  }

  let email: string | null;
  let firstName: string | null;
  try {
    const user = await client().users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    email = primary?.emailAddress.trim().toLowerCase() ?? null;
    firstName = firstNameOf(user);
  } catch {
    return { state: 'anon' };
  }

  if (!email) return { state: 'anon' };
  return ownerEmails.has(email)
    ? { state: 'owner', email, firstName }
    : { state: 'non_owner', email, firstName };
}

export type CurrentUser = {
  email: string;
  role: UserRole;
  /** The account's first name, for the `users` row a claimed invite creates. */
  firstName?: string | null;
};

// Identifies any authenticated account — owner OR editor — and upserts a row
// into `users` so the account is discoverable (invite picker) and its role
// stays in sync with the owner allow-list. Returns null for anonymous callers.
//
// Callers MUST have run `ensureAllSchemas()` first (it creates the `users`
// table). The GraphQL guards in api/_gqlContext.ts build on its result:
// `requireOwnerCtx` remains the gate for site-wide writes and paid endpoints.
export async function getCurrentUserFromToken(token: string | null): Promise<CurrentUser | null> {
  const status = await getCallerStatusFromToken(token);
  if (status.state === 'anon') return null;
  const email = status.email;
  const role: UserRole = status.state === 'owner' ? 'owner' : 'editor';
  // Only owners get a `users` row written here. A non-owner row is created
  // exactly when that account claims a trip invite (the invite-claim path).
  // Writing one for *every* authenticated visitor would let any random
  // Google sign-in seed a row and pollute the global invite-picker
  // autocomplete (#51 c4), which is meant to list owners + invitees only.
  // The upsert also keeps `role` correct if an editor is later promoted into
  // OWNER_EMAILS, and `display_name` the account's first name from Clerk, so
  // people show as "Tarun" rather than their email (a name Clerk has none
  // for keeps the one stored).
  if (role === 'owner') {
    await db().execute({
      sql: `INSERT INTO users (email, display_name, created_at, role)
            VALUES (?, ?, ?, 'owner')
            ON CONFLICT(email) DO UPDATE SET
              role = 'owner',
              display_name = COALESCE(excluded.display_name, users.display_name)`,
      args: [email, status.firstName, Date.now()],
    });
  } else if (status.firstName && !nameSynced(email, status.firstName)) {
    await syncEditorName(email, status.firstName);
  }
  return { email, role, firstName: status.firstName };
}

// The first name last written for each editor in this instance, or tried
// for an account with no row yet, until when it needn't be tried again.
const namesSynced = new Map<string, { name: string; until: number }>();

// How long a name with no row to land in waits before it's tried again: a row
// an accepted suggestion creates gets it within this, and a signed-in account
// with no row doesn't write on every request.
const NO_ROW_RETRY_MS = 10 * 60 * 1000;

function nameSynced(email: string, firstName: string): boolean {
  const synced = namesSynced.get(email);
  return synced?.name === firstName && synced.until > Date.now();
}

// An editor's row, which only an invite claim or an accepted suggestion
// creates, takes their first name too; never a new row. Remembered once it
// lands, so a signed-in editor's requests on a warm instance don't each
// write; with no row yet, it's tried again after a while. A failed write
// leaves the name for the next request rather than failing this one.
async function syncEditorName(email: string, firstName: string): Promise<void> {
  try {
    const rs = await db().execute({
      sql: 'UPDATE users SET display_name = ? WHERE email = ?',
      args: [firstName, email],
    });
    namesSynced.set(email, {
      name: firstName,
      until: rs.rowsAffected > 0 ? Infinity : Date.now() + NO_ROW_RETRY_MS,
    });
  } catch {
    // Named from their email until a later request writes it.
  }
}
