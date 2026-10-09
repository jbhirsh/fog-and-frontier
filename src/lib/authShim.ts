import { createContext, useContext } from 'react';

// A tiny abstraction over Clerk so the app renders without a Clerk
// publishable key configured. When `VITE_CLERK_PUBLISHABLE_KEY` is
// missing (e.g. a fresh Preview deployment), `<AuthProvider>` falls
// back to a no-auth shim that treats every visitor as signed-out:
// the site stays viewable, owner-gated UI is hidden (#67), and the
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
  const state = useContext(AuthCtx);
  // Dev/test-only: Playwright signs in as window.__TEST_FORCE_EMAIL__ to
  // snapshot signed-in views (the trips pages, #59) without a Clerk session.
  // Like __TEST_FORCE_OWNER__ in useOwner, the mode check is evaluated at
  // build time, so production ignores the flag.
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    const forced = (window as { __TEST_FORCE_EMAIL__?: unknown }).__TEST_FORCE_EMAIL__;
    if (typeof forced === 'string' && forced) {
      return { ...state, isLoaded: true, email: forced };
    }
  }
  return state;
}
