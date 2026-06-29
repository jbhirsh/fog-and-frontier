import type { VercelRequest, VercelResponse } from '@vercel/node';
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

function bearerToken(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
}

// Tri-state caller status so `requireOwner` can distinguish anon (401) from
// signed-in non-owner (403) per #50 AC. Clerk/network failures collapse to
// `anon` since we can't trust the identity — same conservative posture as
// the prior boolean helper.
export type CallerStatus =
  | { state: 'anon' }
  | { state: 'non_owner'; email: string }
  | { state: 'owner'; email: string };

// Token-core: resolve a caller from a raw Bearer token string (no req object).
// The GraphQL context (api/_gqlContext.ts) authenticates from a bare token, so
// the identity logic lives here and the `(req)` helpers below just extract the
// token and delegate. Clerk/network failures collapse to `anon` since we can't
// trust the identity — same conservative posture as the prior boolean helper.
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
    email = primary?.emailAddress?.trim().toLowerCase() ?? null;
  } catch {
    return { state: 'anon' };
  }

  if (!email) return { state: 'anon' };
  return ownerEmails.has(email)
    ? { state: 'owner', email }
    : { state: 'non_owner', email };
}

export async function getCallerStatus(req: VercelRequest): Promise<CallerStatus> {
  return getCallerStatusFromToken(bearerToken(req));
}

export async function getOwnerEmail(req: VercelRequest): Promise<string | null> {
  const status = await getCallerStatus(req);
  return status.state === 'owner' ? status.email : null;
}

export async function requireOwner(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const status = await getCallerStatus(req);
  if (status.state === 'owner') return status.email;
  if (status.state === 'non_owner') {
    res.status(403).json({ error: 'forbidden' });
  } else {
    res.status(401).json({ error: 'unauthorized' });
  }
  return null;
}

export type CurrentUser = { email: string; role: UserRole };

// Identifies any authenticated account — owner OR editor — and upserts a row
// into `users` so the account is discoverable (invite picker) and its role
// stays in sync with the owner allow-list. Returns null for anonymous callers.
//
// Callers MUST have run `ensureTripsSchema()` first (it creates the `users`
// table). Complements `requireOwner`, which remains the gate for site-wide
// writes and paid endpoints.
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

export async function getCurrentUser(
  req: VercelRequest,
): Promise<CurrentUser | null> {
  return getCurrentUserFromToken(bearerToken(req));
}
