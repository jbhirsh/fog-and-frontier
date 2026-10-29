import { createAuthClient } from 'better-auth/react';
import { oneTapClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

// The browser's side of sign-in (api/_betterAuth.ts): it talks to this
// site's own /api/auth, which sets the session cookie every API request then
// carries. Nothing here gates a read; useSession is only what the UI shows.

/**
 * Production's own Google client for One Tap (oneTap.ts),
 * or '' on any other deployment: the server takes One Tap only there, and
 * only for this client (see api/_betterAuth.ts).
 */
export const ONE_TAP_CLIENT_ID =
  import.meta.env.VITE_VERCEL_ENV === 'production'
    ? (import.meta.env.VITE_GOOGLE_ONE_TAP_CLIENT_ID ?? '')
    : '';

/** Whether Sign in with Apple is set up (its Services ID is). */
export const APPLE_SIGN_IN = Boolean(import.meta.env.VITE_APPLE_CLIENT_ID);

export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    // Also tells the browser, at sign-out, not to sign back in unasked.
    oneTapClient({
      clientId: ONE_TAP_CLIENT_ID,
      cancelOnTapOutside: true,
      // Asked once: a visitor who closes it isn't asked again on this page.
      promptOptions: { maxAttempts: 0 },
    }),
  ],
});
