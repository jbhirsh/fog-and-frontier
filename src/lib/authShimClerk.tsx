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

  // Reset the Apollo cache when the account changes after Clerk has loaded:
  // sign-out or an in-tab multi-session switch, so account A's member-scoped
  // trips/members/votes/invites can't bleed into account B's session, and
  // sign-in, so reads cached signed-out (the catalog, without contributors,
  // #9) refetch as the caller. The account Clerk loads with isn't a change:
  // the reads before it waited for its token.
  const prevUserId = useRef<string | null | undefined>(undefined);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!isLoaded) return;
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      void apolloClient.resetStore().catch(() => {});
    }
    prevUserId.current = userId;
  }, [isLoaded, userId]);

  const value: AuthState = {
    isLoaded,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    getToken: () => getToken(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
