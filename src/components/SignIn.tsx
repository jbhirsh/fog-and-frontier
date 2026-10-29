import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { APPLE_SIGN_IN, ONE_TAP_CLIENT_ID, authClient } from '../lib/authClient';
import { holdOneTapPrompt, renderGoogleButton } from '../lib/oneTap';
import { passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';
import { AppleLogo, GoogleLogo } from './ProviderLogos';

/** How long the dialog waits for Google's button before showing its own. */
const GOOGLE_BUTTON_WAIT_MS = 2500;

const PROVIDER =
  'flex h-11 w-full items-center justify-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-md font-body-md text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50';

/**
 * Google, as Google draws it where it can (production, with its own
 * client, which also offers One Tap), otherwise as this app does, through
 * the same redirect sign-in as Apple's.
 */
function GoogleButton({
  disabled,
  onRedirect,
  onSignedIn,
}: {
  disabled: boolean;
  onRedirect: () => void;
  onSignedIn: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  // Waiting on Google's button (production), then Google's or this app's,
  // so neither shows and then gives way to the other.
  const [shown, setShown] = useState<'waiting' | 'google' | 'own'>(
    ONE_TAP_CLIENT_ID ? 'waiting' : 'own',
  );
  // The latest onSignedIn, for a sign-in that ends after a re-render.
  const signedIn = useRef(onSignedIn);
  useEffect(() => {
    signedIn.current = onSignedIn;
  });
  useEffect(() => {
    if (!ONE_TAP_CLIENT_ID || !wrap.current || !slot.current) return;
    // Google's script can be slow to come (or never, if blocked). Neither
    // needs undoing on unmount: React drops a state update then.
    window.setTimeout(() => {
      setShown((now) => (now === 'waiting' ? 'own' : now));
    }, GOOGLE_BUTTON_WAIT_MS);
    void renderGoogleButton(slot.current, wrap.current.clientWidth, () => signedIn.current()).then(
      (ok) => {
        setShown((now) => (now === 'waiting' ? (ok ? 'google' : 'own') : now));
      },
    );
  }, []);
  return (
    <div ref={wrap} aria-busy={shown === 'waiting'}>
      <div
        ref={slot}
        data-testid="google-slot"
        className={
          shown === 'own'
            ? 'hidden'
            : `flex h-11 items-center justify-center ${shown === 'waiting' ? 'rounded-lg border border-outline-variant/60' : ''}`
        }
      />
      {shown === 'own' && (
        <button type="button" onClick={onRedirect} disabled={disabled} className={PROVIDER}>
          <GoogleLogo />
          Continue with Google
        </button>
      )}
    </div>
  );
}

/**
 * Signing in, laid out as a card like the hosted sign-in it replaced:
 * Apple and Google, which come back to this page, or a passkey made
 * earlier from the account menu (AccountMenu). There's no separate sign-up:
 * a first sign-in makes the account.
 */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The dialog asks instead of One Tap's prompt while it's open.
  useEffect(() => holdOneTapPrompt(), []);

  async function withProvider(provider: 'google' | 'apple', label: string) {
    setBusy(true);
    setError(null);
    // Sends the browser to Google or Apple, which come back here signed in.
    const { error: failed } = await authClient.signIn.social({
      provider,
      callbackURL: window.location.href,
    });
    if (failed) {
      setBusy(false);
      setError(`${label} sign-in didn’t start. Try again.`);
    }
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    setBusy(false);
    if (result.error) {
      setError('That passkey didn’t sign you in. Try Google or Apple, then add a passkey.');
      return;
    }
    onClose();
  }

  return (
    <ModalShell title="Sign in" layout="card" onCancel={onClose}>
      <div className="space-y-md p-md pt-lg">
        <header className="text-center">
          <img
            src="/icon-192.png"
            alt=""
            width={44}
            height={44}
            className="mx-auto mb-md size-11 rounded-xl"
          />
          <h2 className="font-headline-md text-lg font-semibold text-on-surface">
            Sign in to Fog and Frontier
          </h2>
          <p className="font-body-md text-body-sm text-on-surface-variant">
            Welcome back! Please sign in to continue.
          </p>
        </header>
        <div className="space-y-sm">
          {APPLE_SIGN_IN && (
            <button
              type="button"
              onClick={() => void withProvider('apple', 'Apple')}
              disabled={busy}
              className={PROVIDER}
            >
              <AppleLogo />
              Continue with Apple
            </button>
          )}
          <GoogleButton
            disabled={busy}
            onRedirect={() => void withProvider('google', 'Google')}
            onSignedIn={onClose}
          />
        </div>
        {passkeysSupported() && (
          <>
            <div
              className="flex items-center gap-md font-body-md text-body-sm text-on-surface-variant"
              aria-hidden="true"
            >
              <span className="h-px flex-1 bg-outline-variant" />
              or
              <span className="h-px flex-1 bg-outline-variant" />
            </div>
            <button
              type="button"
              onClick={() => void withPasskey()}
              disabled={busy}
              className={PROVIDER}
            >
              <span className="material-symbols-outlined text-icon-md" aria-hidden="true">
                passkey
              </span>
              Sign in with a passkey
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="text-center font-body-md text-body-sm text-error">
            {error}
          </p>
        )}
      </div>
      <p className="border-t border-outline-variant/40 bg-surface-container-low px-md py-sm text-center font-body-md text-body-sm text-on-surface-variant">
        New here? Your first sign-in makes your account.
      </p>
    </ModalShell>
  );
}

/**
 * A button, styled by its caller, that opens the sign-in dialog. The dialog
 * goes to the body: in the header, whose blur makes it the box a fixed
 * overlay fills, it would cover only the header.
 */
export function SignInButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && createPortal(<SignInDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
