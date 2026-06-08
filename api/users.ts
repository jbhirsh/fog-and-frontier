import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorLogging } from './_log.js';
import { getCurrentUser } from './_auth.js';
import { ensureTripsSchema, getAllUsers } from './_trips.js';

// GET /api/users — the global account list backing the invite-picker
// autocomplete (#51 c4). Any authenticated account may read it; the list is
// owners + accounts that have claimed an invite (no random sign-ins, since
// those never get a users row).

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const users = await getAllUsers();
  res.status(200).json(users);
});
