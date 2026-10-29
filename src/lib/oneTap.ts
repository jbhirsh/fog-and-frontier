import { useEffect } from 'react';
import { ONE_TAP_CLIENT_ID, authClient } from './authClient';

// Google's own sign-in on production, through Better Auth's One Tap client:
// the One Tap prompt and Google's button, each handing back an ID token for
// ONE_TAP_CLIENT_ID, which /api/auth/one-tap/callback turns into a session.
// Google's script loads only once the page has settled and gone idle, so a
// visit never waits on it. A sign-in through it neither leaves the page nor
// re-reads the session by itself (there's no callbackURL), so it tells
// useSession to.

function signedIn(then?: () => void) {
  return {
    onSuccess: () => {
      authClient.$store.notify('$sessionSignal');
      then?.();
    },
  };
}

/**
 * How long the prompt waits before it loads Google's script: the app's
 * first reads have gone out within a second of the session answering, and
 * its catalog and first photos are mostly in by then. (The page's load
 * event comes before the reads do, so it says nothing.)
 */
const SETTLE_MS = 3000;

/** Runs `start` once the page has settled and the browser is idle. */
function whenSettled(start: () => void): () => void {
  let idle = 0;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(start, { timeout: 4000 });
    } else start();
  }, SETTLE_MS);
  return () => {
    window.clearTimeout(timer);
    if (idle) window.cancelIdleCallback(idle);
  };
}

/** Closes a One Tap prompt that's showing: the library has no way to. */
function cancelPrompt() {
  (
    window as { google?: { accounts?: { id?: { cancel?: () => void } } } }
  ).google?.accounts?.id?.cancel?.();
}

let held = 0;

/**
 * Keeps the One Tap prompt away while a sign-in dialog is open, closing one
 * already showing (the dialog asks instead); the returned function lets go.
 */
export function holdOneTapPrompt(): () => void {
  held += 1;
  cancelPrompt();
  return () => {
    held -= 1;
  };
}

/**
 * Offers a signed-out visitor Google's One Tap prompt, once the page
 * settles, unless a sign-in dialog is open; and closes it once they're
 * signed in some other way (a passkey).
 */
export function useOneTapPrompt(signedOut: boolean): void {
  useEffect(() => {
    if (!ONE_TAP_CLIENT_ID || !signedOut) return;
    const stop = whenSettled(() => {
      if (held) return;
      authClient.oneTap({ fetchOptions: signedIn() }).catch(() => {});
    });
    return () => {
      stop();
      cancelPrompt();
    };
  }, [signedOut]);
}

/**
 * Draws Google's "Continue with Google" button into `container`, `width`
 * wide, and says whether it did: not off production, nor where Google's
 * script is blocked, nor while the library's prompt is still open (it draws
 * no button then), where the caller shows its own.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  width: number,
  onSignedIn: () => void,
): Promise<boolean> {
  if (!ONE_TAP_CLIENT_ID) return false;
  try {
    await authClient.oneTap({
      button: {
        container,
        config: {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          // Google draws 200 to 400 pixels wide.
          width: Math.max(200, Math.min(400, Math.round(width))),
        },
      },
      fetchOptions: signedIn(onSignedIn),
    });
  } catch {
    return false;
  }
  return container.childElementCount > 0;
}
