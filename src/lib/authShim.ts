import { createContext, useContext } from 'react';

// Who is signed in, as the UI sees it. <AuthProvider> (authSession.tsx) fills
// it from the session cookie's account; without it every visitor is signed
// out: the site stays viewable, owner-gated UI is hidden (#67), and no
// sign-in shows.

/**
 * Whether this build can sign anyone in: one Vercel made (production, a
 * preview, or `vercel dev`), which serves /api/auth beside the app. Builds
 * made elsewhere (the visual tests', the PR GIFs', the README screenshots')
 * have no sign-in to offer, and show none.
 */
export const SIGN_IN_ENABLED = Boolean(import.meta.env.VITE_VERCEL_ENV);

export type AuthState = {
  isLoaded: boolean;
  email: string | null;
  /** The account's first name, as attributions show it. */
  name: string | null;
};

const NO_AUTH: AuthState = {
  isLoaded: true,
  email: null,
  name: null,
};

export const AuthCtx = createContext<AuthState>(NO_AUTH);

export function useAuthState(): AuthState {
  const state = useContext(AuthCtx);
  // Dev/test-only: Playwright signs in as window.__TEST_FORCE_EMAIL__ to
  // snapshot signed-in views (the trips pages, #59) without a session.
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
