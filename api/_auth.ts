import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClerkClient, verifyToken } from '@clerk/backend';

// Files in api/ that start with `_` are not exposed as routes by Vercel.

const secretKey = process.env.CLERK_SECRET_KEY ?? '';
const ownerEmails = new Set(
  (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

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

export async function getCallerStatus(req: VercelRequest): Promise<CallerStatus> {
  if (!secretKey || ownerEmails.size === 0) return { state: 'anon' };
  const token = bearerToken(req);
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
