import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { computeMembership, useTripMembership, type Membership } from './useTripMembership';
import type { TripMember } from './userTrips';

// The hook joins three others: stub each with what a test sets.
const state = vi.hoisted(() => ({
  trip: null as { members: TripMember[] } | null,
  tripLoading: false,
  email: null as string | null,
  isOwner: false,
  ownerLoaded: true,
  tripIds: [] as (string | undefined)[],
}));
vi.mock('./userTrips', () => ({
  useTrip: (id: string | undefined) => {
    state.tripIds.push(id);
    return { trip: state.trip, isLoading: state.tripLoading };
  },
}));
vi.mock('./authShim', () => ({ useAuthState: () => ({ email: state.email }) }));
vi.mock('./useOwner', () => ({
  useOwner: () => ({ isOwner: state.isOwner, isLoaded: state.ownerLoaded }),
}));

function member(overrides: Partial<TripMember> = {}): TripMember {
  return {
    email: 'alice@example.com',
    display_name: null,
    added_by_email: 'alice@example.com',
    added_at: 1_000_000,
    is_creator: false,
    ...overrides,
  };
}

function trip(members: TripMember[]) {
  return { members };
}

describe('computeMembership', () => {
  it('returns not-a-member when trip is null', () => {
    const result: Membership = computeMembership(null, 'alice@example.com', false);
    expect(result).toEqual({ isMember: false, isCreator: false, role: null });
  });

  it('returns not-a-member when email is null', () => {
    const result = computeMembership(trip([member()]), null, false);
    expect(result).toEqual({ isMember: false, isCreator: false, role: null });
  });

  it('returns not-a-member when both trip and email are null', () => {
    const result = computeMembership(null, null, false);
    expect(result).toEqual({ isMember: false, isCreator: false, role: null });
  });

  it('returns editor role for a plain member (non-creator, non-owner)', () => {
    const result = computeMembership(
      trip([member({ email: 'alice@example.com', is_creator: false })]),
      'alice@example.com',
      false,
    );
    expect(result).toEqual({ isMember: true, isCreator: false, role: 'editor' });
  });

  it('returns isCreator true and role editor for the trip creator (non-owner account)', () => {
    const result = computeMembership(
      trip([member({ email: 'alice@example.com', is_creator: true })]),
      'alice@example.com',
      false,
    );
    expect(result).toEqual({ isMember: true, isCreator: true, role: 'editor' });
  });

  it('returns role owner for an owner account who is also a member', () => {
    const result = computeMembership(
      trip([member({ email: 'alice@example.com', is_creator: true })]),
      'alice@example.com',
      true,
    );
    expect(result).toEqual({ isMember: true, isCreator: true, role: 'owner' });
  });

  it('returns role owner for an owner account who is NOT in the members list', () => {
    // Owners can view trips even when not a listed member; still gets 'owner' role.
    const result = computeMembership(
      trip([member({ email: 'other@example.com' })]),
      'owner@example.com',
      true,
    );
    expect(result).toEqual({ isMember: false, isCreator: false, role: 'owner' });
  });

  it('matches emails case-insensitively', () => {
    const result = computeMembership(
      trip([member({ email: 'Alice@Example.COM', is_creator: false })]),
      'alice@example.com',
      false,
    );
    expect(result).toEqual({ isMember: true, isCreator: false, role: 'editor' });
  });

  it('also normalizes the incoming email for comparison', () => {
    const result = computeMembership(
      trip([member({ email: 'alice@example.com', is_creator: false })]),
      'ALICE@EXAMPLE.COM',
      false,
    );
    expect(result).toEqual({ isMember: true, isCreator: false, role: 'editor' });
  });

  it('returns role null for a non-member email', () => {
    const result = computeMembership(
      trip([member({ email: 'alice@example.com' })]),
      'bob@example.com',
      false,
    );
    expect(result).toEqual({ isMember: false, isCreator: false, role: null });
  });

  it('returns not-a-member for an empty members array', () => {
    const result = computeMembership(trip([]), 'alice@example.com', false);
    expect(result).toEqual({ isMember: false, isCreator: false, role: null });
  });
});

describe('useTripMembership', () => {
  function setup(over: Partial<typeof state> = {}) {
    Object.assign(state, {
      trip: null,
      tripLoading: false,
      email: null,
      isOwner: false,
      ownerLoaded: true,
      tripIds: [],
      ...over,
    });
  }

  it('loads the given trip and reports the signed-in member’s role', () => {
    setup({
      trip: trip([member({ email: 'alice@example.com', is_creator: true })]),
      email: 'alice@example.com',
    });
    const { result } = renderHook(() => useTripMembership('trip-1'));
    expect(state.tripIds).toContain('trip-1');
    expect(result.current).toEqual({
      isLoaded: true,
      isMember: true,
      isCreator: true,
      role: 'editor',
    });
  });

  it('gives an owner the owner role', () => {
    setup({ trip: trip([]), email: 'owner@example.com', isOwner: true });
    const { result } = renderHook(() => useTripMembership('trip-1'));
    expect(result.current).toEqual({
      isLoaded: true,
      isMember: false,
      isCreator: false,
      role: 'owner',
    });
  });

  it('is not loaded while the trip loads', () => {
    setup({ tripLoading: true });
    const { result } = renderHook(() => useTripMembership('trip-1'));
    expect(result.current.isLoaded).toBe(false);
  });

  it('is not loaded while the owner check loads', () => {
    setup({ ownerLoaded: false });
    const { result } = renderHook(() => useTripMembership(undefined));
    expect(state.tripIds).toContain(undefined);
    expect(result.current).toEqual({
      isLoaded: false,
      isMember: false,
      isCreator: false,
      role: null,
    });
  });
});
