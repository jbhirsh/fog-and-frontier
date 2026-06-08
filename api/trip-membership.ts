import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorLogging } from './_log.js';
import { getCurrentUser } from './_auth.js';
import {
  addTripMember,
  createInvite,
  deleteInviteByToken,
  ensureTripsSchema,
  getInviteByToken,
  getTripRow,
  isTripMember,
  removeTripMember,
  requireMember,
  upsertUser,
} from './_trips.js';

// Trip membership + invites + invite-claim (#51), consolidated into one
// function to stay under Vercel's per-deployment Serverless Function cap.
// Dispatch by method + params:
//   POST /api/trip-membership            { invite_token }
//     Claim an invite (token IS the credential, c2 — no email match, any authed
//     account). Creates the claimer's account row (an editor account is born
//     here), adds them to the trip, consumes the invite.
//   POST /api/trip-membership?id=<id>    { email }
//     Invite by email — any member. Creates a pending invite carrying a token;
//     invited_email is informational (labels the picker). Returns the invite.
//   DELETE /api/trip-membership?id=<id>&token=<t>
//     Revoke a pending invite — any member.
//   DELETE /api/trip-membership?id=<id>&email=<e>
//     Remove a member — creator removes anyone; a member removes themselves
//     ("Leave trip"). The creator can't leave (409; delete the trip instead).

// Loose on purpose (#51 c17) — Clerk is the real validator at sign-in.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function queryParam(req: VercelRequest, key: string): string | null {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  const body = (req.body ?? {}) as { email?: unknown; invite_token?: unknown };

  if (req.method === 'POST') {
    // Claim: identified by an invite_token body and no trip id (the token
    // resolves the trip). Any authed account.
    if (typeof body.invite_token === 'string' && body.invite_token) {
      await claim(req, res, body.invite_token);
      return;
    }
    // Otherwise it's an invite-by-email on a specific trip — any member.
    const tripId = queryParam(req, 'id');
    if (!tripId) {
      res.status(400).json({ error: 'missing id' });
      return;
    }
    const ctx = await requireMember(req, res, tripId);
    if (!ctx) return;
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'invalid email' });
      return;
    }
    if (await isTripMember(tripId, email)) {
      res.status(409).json({ error: 'already a member', code: 'already_member' });
      return;
    }
    const invite = await createInvite(tripId, email, ctx.email);
    res.status(201).json(invite);
    return;
  }

  if (req.method === 'DELETE') {
    const tripId = queryParam(req, 'id');
    if (!tripId) {
      res.status(400).json({ error: 'missing id' });
      return;
    }
    const token = queryParam(req, 'token');
    const email = (queryParam(req, 'email') ?? '').trim().toLowerCase();

    if (token) {
      // Revoke a pending invite — any member.
      const ctx = await requireMember(req, res, tripId);
      if (!ctx) return;
      await deleteInviteByToken(tripId, token);
      res.status(200).json({ ok: true });
      return;
    }

    if (!email) {
      res.status(400).json({ error: 'missing email or token' });
      return;
    }
    const ctx = await requireMember(req, res, tripId);
    if (!ctx) return;
    const isSelf = email === ctx.email;
    if (!isSelf && !ctx.isCreator) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const trip = await getTripRow(tripId);
    if (!trip) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // The creator can't leave their own trip — they'd orphan it. Deleting the
    // trip is the intended exit (transfer-creator is out of scope, #51).
    if (isSelf && trip.creator_email === ctx.email) {
      res.status(409).json({
        error: 'the creator cannot leave; delete the trip instead',
        code: 'creator_cannot_leave',
      });
      return;
    }
    await removeTripMember(tripId, email);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
});

async function claim(
  req: VercelRequest,
  res: VercelResponse,
  token: string,
): Promise<void> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const invite = await getInviteByToken(token);
  if (!invite) {
    res.status(404).json({ error: 'invite not found', code: 'invite_invalid' });
    return;
  }
  const trip = await getTripRow(invite.trip_id);
  if (!trip) {
    res.status(404).json({ error: 'trip not found' });
    return;
  }
  // Already a member? Consume the dangling invite and succeed idempotently.
  if (await isTripMember(invite.trip_id, user.email)) {
    await deleteInviteByToken(invite.trip_id, token);
    res.status(200).json({ ok: true, trip_id: invite.trip_id });
    return;
  }
  // Create/refresh the claimer's account row, add them, consume the invite.
  await upsertUser(user.email);
  await addTripMember(invite.trip_id, user.email, invite.invited_by_email);
  await deleteInviteByToken(invite.trip_id, token);
  res.status(200).json({ ok: true, trip_id: invite.trip_id });
}
