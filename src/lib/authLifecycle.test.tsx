import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useContext, type ReactNode } from 'react';
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
// Auth-gated reads (TRIPS_QUERY/TRIP_QUERY) must NOT fire before the session
// is loaded — an anon request returns UNAUTHENTICATED and the link has no retry,
// so a signed-in user's first load would stick on an error. They must fire
// once isLoaded flips true.

function authWrapper(isLoaded: boolean) {
  const value: AuthState = {
    isLoaded,
    email: isLoaded ? 'owner@example.com' : null,
    name: null,
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
        const op = (JSON.parse(opts.body) as { operationName?: string }).operationName;
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

const session = vi.hoisted(() => ({
  isPending: false,
  user: null as null | { id: string; email: string; name: string },
}));

vi.mock('./authClient', () => ({
  authClient: {
    useSession: () => ({
      isPending: session.isPending,
      data: session.user ? { user: session.user } : null,
    }),
  },
}));

const as = (id: string) => ({ id, email: `${id.toLowerCase()}@example.com`, name: id });

describe('cache reset on account change (MAJOR-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    session.isPending = false;
    session.user = null;
  });

  it('resets the cache on account switch and sign-out, but not on initial sign-in', async () => {
    const { AuthProvider } = await import('./authSession');
    const reset = vi.spyOn(apolloClient, 'resetStore').mockResolvedValue([]);

    session.user = as('A');
    const { rerender } = rtlRender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).not.toHaveBeenCalled(); // initial sign-in: no prior user

    session.user = as('B'); // in-tab account switch
    rerender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).toHaveBeenCalledTimes(1);

    session.user = null; // sign-out
    rerender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).toHaveBeenCalledTimes(2);
  });

  // A reset that fails (offline) is let go: a mock's own promise tracking
  // would hide an unhandled rejection, so this checks the .catch itself.
  it('lets a failed reset go, rather than leaving its rejection unhandled', async () => {
    const { AuthProvider } = await import('./authSession');
    const failed = Promise.reject(new Error('offline'));
    const caught = vi.spyOn(failed, 'catch');
    vi.spyOn(apolloClient, 'resetStore').mockReturnValue(failed);

    session.user = as('A');
    const { rerender } = rtlRender(createElement(AuthProvider, { children: 'x' }));
    session.user = null;
    rerender(createElement(AuthProvider, { children: 'x' }));
    expect(caught).toHaveBeenCalledOnce();
  });

  // Reads made signed-out (the catalog, without contributors, #9) must
  // refetch as the caller once they sign in from the page.
  it('resets the cache when a signed-out visitor signs in', async () => {
    const { AuthProvider } = await import('./authSession');
    const reset = vi.spyOn(apolloClient, 'resetStore').mockResolvedValue([]);

    session.user = null;
    const { rerender } = rtlRender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).not.toHaveBeenCalled();

    session.user = as('A');
    rerender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not reset when the session finishes loading an account', async () => {
    const { AuthProvider } = await import('./authSession');
    const reset = vi.spyOn(apolloClient, 'resetStore').mockResolvedValue([]);

    session.isPending = true;
    session.user = null;
    const { rerender } = rtlRender(createElement(AuthProvider, { children: 'x' }));

    session.isPending = false;
    session.user = as('A');
    rerender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not reset when the session reloads the same account', async () => {
    const { AuthProvider } = await import('./authSession');
    const reset = vi.spyOn(apolloClient, 'resetStore').mockResolvedValue([]);

    session.user = as('A');
    const { rerender } = rtlRender(createElement(AuthProvider, { children: 'x' }));
    session.isPending = true;
    rerender(createElement(AuthProvider, { children: 'x' }));
    session.isPending = false;
    rerender(createElement(AuthProvider, { children: 'x' }));
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('AuthProvider', () => {
  afterEach(() => {
    session.isPending = false;
    session.user = null;
  });

  async function stateWith(user: typeof session.user, isPending = false) {
    const { AuthProvider } = await import('./authSession');
    session.user = user;
    session.isPending = isPending;
    const seen: { state: AuthState | null } = { state: null };
    function Probe() {
      seen.state = useContext(AuthCtx);
      return null;
    }
    rtlRender(createElement(AuthProvider, { children: createElement(Probe) }));
    return seen.state;
  }

  it('gives the signed-in account’s email, lowercased, and its first name', async () => {
    expect(await stateWith({ id: 'A', email: ' Jess@Example.com ', name: ' Jess ' })).toEqual({
      isLoaded: true,
      email: 'jess@example.com',
      name: 'Jess',
    });
  });

  it('gives no name for an account without one', async () => {
    expect((await stateWith({ id: 'A', email: 'a@example.com', name: '' }))?.name).toBeNull();
  });

  it('is signed out and still loading until the session answers', async () => {
    expect(await stateWith(null, true)).toEqual({ isLoaded: false, email: null, name: null });
  });
});
