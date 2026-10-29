import { useEffect, useRef, type ReactNode } from 'react';
import { AuthCtx, type AuthState } from './authShim';
import { apolloClient } from './apolloClient';
import { authClient } from './authClient';

// Who is signed in, from the session cookie's account (Better Auth's
// useSession, which asks /api/auth once as the app opens, beside its first
// reads rather than ahead of them: the cookie goes with those reads anyway).
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const user = data?.user ?? null;

  // Reset the Apollo cache when the account changes after the session has
  // loaded: sign-out, so account A's member-scoped trips/members/votes/
  // invites can't bleed into account B's session, and sign-in, so reads
  // cached signed-out (the catalog, without contributors, #9) refetch as the
  // caller. The account the app opens with isn't a change: its first reads
  // already carried its cookie.
  const prevUserId = useRef<string | null | undefined>(undefined);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (isPending) return;
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      void apolloClient.resetStore().catch(() => {});
    }
    prevUserId.current = userId;
  }, [isPending, userId]);

  const value: AuthState = {
    isLoaded: !isPending,
    email: user?.email.trim().toLowerCase() ?? null,
    name: user?.name.trim() || null,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
