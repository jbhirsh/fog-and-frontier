import { createContext, useContext } from 'react';

// A tiny abstraction over Clerk so the app renders without a Clerk
// publishable key configured. When `VITE_CLERK_PUBLISHABLE_KEY` is
// missing (e.g. a fresh Preview deployment), `<AuthProvider>` falls
// back to a no-auth shim that treats every visitor as signed-out:
// the site stays viewable, owner-gated UI is greyed out, and the
// sign-in button is hidden until Clerk is configured.

export const CLERK_ENABLED = Boolean(
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

export type AuthState = {
  isLoaded: boolean;
  email: string | null;
  getToken: () => Promise<string | null>;
};

const NO_AUTH: AuthState = {
  isLoaded: true,
  email: null,
  getToken: () => Promise.resolve(null),
};

export const AuthCtx = createContext<AuthState>(NO_AUTH);

export function useAuthState(): AuthState {
  return useContext(AuthCtx);
}
