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
  | { state: 'non_owner'; email: string }
  | { state: 'owner'; email: string };

// Token-core: resolve a caller from a raw Bearer token string (no req object).
// The GraphQL context (api/_gqlContext.ts) extracts the token from the request
// and authenticates from it, so the identity logic lives here.
export async function getCallerStatusFromToken(
  token: string | null,
): Promise<CallerStatus> {
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
  try {
    const user = await client().users.getUser(userId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    email = primary?.emailAddress.trim().toLowerCase() ?? null;
  } catch {
    return { state: 'anon' };
  }

  if (!email) return { state: 'anon' };
  return ownerEmails.has(email)
    ? { state: 'owner', email }
    : { state: 'non_owner', email };
}

export type CurrentUser = { email: string; role: UserRole };

// Identifies any authenticated account — owner OR editor — and upserts a row
// into `users` so the account is discoverable (invite picker) and its role
// stays in sync with the owner allow-list. Returns null for anonymous callers.
//
// Callers MUST have run `ensureTripsSchema()` first (it creates the `users`
// table). The GraphQL guards in api/_gqlContext.ts build on its result:
// `requireOwnerCtx` remains the gate for site-wide writes and paid endpoints.
export async function getCurrentUserFromToken(
  token: string | null,
): Promise<CurrentUser | null> {
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
  // OWNER_EMAILS. display_name stays null — Clerk owns it.
  if (role === 'owner') {
    await db().execute({
      sql: `INSERT INTO users (email, display_name, created_at, role)
            VALUES (?, NULL, ?, 'owner')
            ON CONFLICT(email) DO UPDATE SET role = 'owner'`,
      args: [email, Date.now()],
    });
  }
  return { email, role };
}
