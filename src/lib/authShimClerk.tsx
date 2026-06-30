import { useEffect, useRef, type ReactNode } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { AuthCtx, type AuthState } from './authShim';
import { apolloClient, setAuthTokenGetter } from './apolloClient';

// Rendered only inside <ClerkProvider>; safe to call Clerk hooks.
export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();

  // Bridge Clerk's token into the Apollo auth link (which lives outside React
  // and can't call hooks). Re-register whenever getToken changes so the link
  // always reads a live token.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  // Reset the Apollo cache when the signed-in account changes — sign-out or an
  // in-tab multi-session switch — so account A's member-scoped trips/members/
  // votes/invites can't bleed into account B's session. Only fires on a real
  // change away from a logged-in user (skips the initial sign-in, where there's
  // no prior user and the cache is already empty).
  const prevUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = user?.id ?? null;
    if (prevUserId.current && prevUserId.current !== id) {
      void apolloClient.resetStore().catch(() => {});
    }
    prevUserId.current = id;
  }, [user?.id]);

  const value: AuthState = {
    isLoaded,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    getToken: () => getToken(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
