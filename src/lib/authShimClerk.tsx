import type { ReactNode } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { AuthCtx, type AuthState } from './authShim';

// Rendered only inside <ClerkProvider>; safe to call Clerk hooks.
export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const value: AuthState = {
    isLoaded,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    getToken: () => getToken(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
