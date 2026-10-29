import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { APPLE_SIGN_IN, ONE_TAP_CLIENT_ID, authClient } from '../lib/authClient';
import { holdOneTapPrompt, renderGoogleButton } from '../lib/oneTap';
import { passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';

const PROVIDER =
  'flex h-11 w-full items-center justify-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-md font-body-md text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50';

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden="true">
      <path d="M16.37 1.43c0 1.14-.42 2.2-1.26 3.2-1 1.17-2.22 1.84-3.54 1.74a3.6 3.6 0 0 1-.03-.43c0-1.1.48-2.27 1.32-3.21.42-.48.96-.89 1.6-1.2.65-.32 1.26-.48 1.85-.51.02.14.06.29.06.41Zm4.54 16.56c-.36.83-.78 1.59-1.27 2.3-.68.96-1.23 1.62-1.65 2-.66.6-1.37.91-2.12.93-.54 0-1.2-.15-1.96-.47-.77-.31-1.47-.46-2.12-.46-.67 0-1.4.15-2.17.46-.78.32-1.41.48-1.89.5-.72.03-1.44-.29-2.16-.96-.47-.41-1.04-1.1-1.73-2.07a14.4 14.4 0 0 1-1.8-3.6 13.2 13.2 0 0 1-.76-4.28c0-1.59.34-2.95 1.03-4.1a6.06 6.06 0 0 1 2.16-2.2 5.82 5.82 0 0 1 2.93-.82c.57 0 1.32.18 2.25.52.93.35 1.53.53 1.78.53.2 0 .86-.21 1.98-.62 1.07-.37 1.95-.52 2.69-.46 1.98.16 3.46.94 4.45 2.35-1.77 1.07-2.64 2.57-2.62 4.49.01 1.5.55 2.74 1.62 3.73.48.47 1.02.81 1.62 1.07-.13.37-.27.73-.42 1.09Z" />
    </svg>
  );
}

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
  const [drawn, setDrawn] = useState(false);
  // The latest onSignedIn, for a sign-in that ends after a re-render.
  const signedIn = useRef(onSignedIn);
  useEffect(() => {
    signedIn.current = onSignedIn;
  });
  useEffect(() => {
    if (!ONE_TAP_CLIENT_ID || !wrap.current || !slot.current) return;
    let live = true;
    void renderGoogleButton(slot.current, wrap.current.clientWidth, () => signedIn.current()).then(
      (ok) => {
        if (live) setDrawn(ok);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <div ref={wrap}>
      <div ref={slot} className={drawn ? 'flex h-11 items-center justify-center' : 'hidden'} />
      {!drawn && (
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
    if (result?.error) {
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
