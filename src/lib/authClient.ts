import { createAuthClient } from 'better-auth/react';
import { passkeyClient } from '@better-auth/passkey/client';

// The browser's side of sign-in (api/_betterAuth.ts): it talks to this
// site's own /api/auth, which sets the session cookie every API request then
// carries. Nothing here gates a read; useSession is only what the UI shows.
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
