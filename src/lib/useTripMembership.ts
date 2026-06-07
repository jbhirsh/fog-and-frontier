// UI hint only — the server-side requireMember check is the actual gate.
// This hook mirrors the framing of useOwner.ts: it tells the UI whether the
// current user is a trip member so it can grey out or show editing affordances,
// but the server will independently reject any unauthorized mutations.

import { useAuthState } from './authShim';
import { useOwner } from './useOwner';
import { useTrip, type Trip, type UserRole } from './userTrips';

export type Membership = {
  isMember: boolean;
  isCreator: boolean;
  role: UserRole | null; // 'owner' if account is an owner, 'editor' if member but not owner, null if not a member
};

export function computeMembership(
  trip: Pick<Trip, 'members'> | null,
  email: string | null,
  isOwner: boolean,
): Membership {
  if (trip === null || email === null) {
    return { isMember: false, isCreator: false, role: null };
  }
  const lower = email.toLowerCase();
  const match = trip.members.find((m) => m.email.toLowerCase() === lower);
  const isMember = match !== undefined;
  const isCreator = isMember && match.is_creator === true;
  const role: UserRole | null = isOwner ? 'owner' : isMember ? 'editor' : null;
  return { isMember, isCreator, role };
}

export function useTripMembership(tripId: string | undefined): {
  isLoaded: boolean;
  isMember: boolean;
  isCreator: boolean;
  role: UserRole | null;
} {
  const { trip, isLoading: tripLoading } = useTrip(tripId);
  const { email } = useAuthState();
  const { isOwner, isLoaded: ownerLoaded } = useOwner();

  const isLoaded = !tripLoading && ownerLoaded;
  const { isMember, isCreator, role } = computeMembership(trip, email, isOwner);

  return { isLoaded, isMember, isCreator, role };
}
