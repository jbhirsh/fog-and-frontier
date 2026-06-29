import { mapTripInvite } from '../_gqlMap.js';
import {
  claimInvite,
  getAllUsers,
  inviteMember,
  removeMember,
  revokeInvite,
} from '../_trips.js';
import {
  requireMemberCtx,
  requireUserCtx,
  type GqlContext,
} from '../_gqlContext.js';

// Account list + membership/invite mutations. `users` is any authed (the
// invite-picker autocomplete). inviteMember/revokeInvite/removeMember are
// member-gated (removeMember additionally allows self-removal); claimInvite is
// any authed.

async function users(_parent: unknown, _args: unknown, ctx: GqlContext) {
  requireUserCtx(ctx);
  const all = await getAllUsers();
  return all.map((u) => ({ email: u.email, displayName: u.display_name }));
}

async function inviteMemberResolver(
  _parent: unknown,
  { input }: { input: { tripId: string; email: string } },
  ctx: GqlContext,
) {
  const member = await requireMemberCtx(ctx, input.tripId);
  const invite = await inviteMember(input.tripId, input.email, member.email);
  return { invite: mapTripInvite(invite) };
}

async function removeMemberResolver(
  _parent: unknown,
  { input }: { input: { tripId: string; email: string } },
  ctx: GqlContext,
) {
  const member = await requireMemberCtx(ctx, input.tripId);
  const removedEmail = await removeMember(input.tripId, input.email, member);
  return { removedEmail };
}

async function revokeInviteResolver(
  _parent: unknown,
  { input }: { input: { tripId: string; token: string } },
  ctx: GqlContext,
) {
  await requireMemberCtx(ctx, input.tripId);
  const revokedToken = await revokeInvite(input.tripId, input.token);
  return { revokedToken };
}

async function claimInviteResolver(
  _parent: unknown,
  { input }: { input: { inviteToken: string } },
  ctx: GqlContext,
) {
  const user = requireUserCtx(ctx);
  const tripId = await claimInvite(input.inviteToken, user);
  return { tripId };
}

export const membershipQuery = { users };
export const membershipMutation = {
  inviteMember: inviteMemberResolver,
  removeMember: removeMemberResolver,
  revokeInvite: revokeInviteResolver,
  claimInvite: claimInviteResolver,
};
