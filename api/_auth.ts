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

export async function getOwnerEmail(req: VercelRequest): Promise<string | null> {
  if (!secretKey || ownerEmails.size === 0) return null;
  const token = bearerToken(req);
  if (!token) return null;

  let userId: string;
  try {
    const payload = await verifyToken(token, { secretKey });
    if (typeof payload.sub !== 'string') return null;
    userId = payload.sub;
  } catch {
    return null;
  }

  let email: string | null;
  try {
    const user = await client().users.getUser(userId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    email = primary?.emailAddress?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }

  return email && ownerEmails.has(email) ? email : null;
}

export async function requireOwner(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const email = await getOwnerEmail(req);
  if (!email) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return email;
}
