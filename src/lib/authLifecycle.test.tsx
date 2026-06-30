import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, render as rtlRender, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import { AuthCtx, type AuthState } from './authShim';
import { apolloClient } from './apolloClient';
import { useTrip, useTripsList } from './userTrips';

// Regression guards for the two auth-lifecycle bugs the review panel found.

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// --- MAJOR-1: auth-readiness gating ----------------------------------------
// Auth-gated reads (TRIPS_QUERY/TRIP_QUERY) must NOT fire before Clerk is
// loaded — an anon request returns UNAUTHENTICATED and the link has no retry,
// so a signed-in user's first load would stick on an error. They must fire
// once isLoaded flips true.

function authWrapper(isLoaded: boolean) {
  const value: AuthState = {
    isLoaded,
    email: isLoaded ? 'owner@example.com' : null,
    getToken: () => Promise.resolve(isLoaded ? 'tok' : null),
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ApolloProvider, {
      client: apolloClient,
      children: createElement(AuthCtx.Provider, { value, children }),
    });
  };
}

describe('auth-readiness gating (MAJOR-1)', () => {
  let ops: string[];

  beforeEach(() => {
    ops = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        const op = (JSON.parse(opts.body) as { operationName?: string })
          .operationName;
        if (op) ops.push(op);
        if (op === 'TripDetail') {
          return Promise.resolve(jsonResponse({ data: { trip: null } }));
        }
        return Promise.resolve(jsonResponse({ data: { trips: [] } }));
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await apolloClient.clearStore();
  });

  it('useTripsList does not fetch while auth is not loaded', () => {
    const { result } = renderHook(() => useTripsList(), {
      wrapper: authWrapper(false),
    });
    expect(result.current.isLoading).toBe(true);
    expect(ops).not.toContain('TripsList');
  });

  it('useTripsList fetches once auth is loaded', async () => {
    renderHook(() => useTripsList(), { wrapper: authWrapper(true) });
    await waitFor(() => expect(ops).toContain('TripsList'));
  });

  it('useTrip does not fetch while auth is not loaded', () => {
    renderHook(() => useTrip('t1'), { wrapper: authWrapper(false) });
    expect(ops).not.toContain('TripDetail');
  });

  it('useTrip fetches once auth is loaded', async () => {
    renderHook(() => useTrip('t1'), { wrapper: authWrapper(true) });
    await waitFor(() => expect(ops).toContain('TripDetail'));
  });
});

// --- MAJOR-2: cache reset on account change --------------------------------
// Switching accounts in-tab (or signing out) must reset the Apollo cache so
// account A's member-scoped data can't bleed into account B's session.

const clerk = vi.hoisted(() => ({ user: null as null | { id: string } }));

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ isLoaded: true, user: clerk.user }),
  useAuth: () => ({ getToken: () => Promise.resolve('tok') }),
}));

describe('cache reset on account change (MAJOR-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clerk.user = null;
  });

  it('resets the cache on account switch and sign-out, but not on initial sign-in', async () => {
    const { ClerkAuthProvider } = await import('./authShimClerk');
    const reset = vi.spyOn(apolloClient, 'resetStore').mockResolvedValue([]);

    clerk.user = { id: 'A' };
    const { rerender } = rtlRender(createElement(ClerkAuthProvider, { children: 'x' }));
    expect(reset).not.toHaveBeenCalled(); // initial sign-in: no prior user

    clerk.user = { id: 'B' }; // in-tab account switch
    rerender(createElement(ClerkAuthProvider, { children: 'x' }));
    expect(reset).toHaveBeenCalledTimes(1);

    clerk.user = null; // sign-out
    rerender(createElement(ClerkAuthProvider, { children: 'x' }));
    expect(reset).toHaveBeenCalledTimes(2);
  });
});
