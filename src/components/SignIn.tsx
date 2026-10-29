import { useEffect, useState, type ReactNode } from 'react';
import { createPortal, preconnect } from 'react-dom';
import { APPLE_SIGN_IN, authClient } from '../lib/authClient';
import { holdOneTapPrompt } from '../lib/oneTap';
import { useOnPageRestore } from '../lib/pageRestore';
import { passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';
import { AppleLogo, GoogleLogo } from './ProviderLogos';

const PROVIDER =
  'flex h-11 w-full items-center justify-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-md font-body-md text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50';

type Provider = 'google' | 'apple';

const NAMES: Record<Provider, string> = { google: 'Google', apple: 'Apple' };

/**
 * Google's and Apple's sign-in pages. The card connects to them as it
 * opens, so a phone has done the handshake before it's sent there (most of
 * the wait for Apple's is then Apple's own loading, from hosts its page
 * reaches itself, which a connection from this site wouldn't serve).
 */
const SIGN_IN_HOSTS: Record<Provider, string> = {
  google: 'https://accounts.google.com',
  apple: 'https://appleid.apple.com',
};

/** The providers the card offers: Apple (once it's set up), then Google. */
function signInProviders(): Provider[] {
  return APPLE_SIGN_IN ? ['apple', 'google'] : ['google'];
}

/**
 * Signing in, laid out as a card like the hosted sign-in it replaced:
 * Apple and Google, which come back to this page, or a passkey made
 * earlier from the account menu (AccountMenu). There's no separate sign-up:
 * a first sign-in makes the account.
 */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [opening, setOpening] = useState<Provider | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = opening !== null || checking;
  const providers = signInProviders();
  // The dialog asks instead of One Tap's prompt while it's open.
  useEffect(() => holdOneTapPrompt(), []);
  useOnPageRestore(() => setOpening(null));
  useEffect(() => {
    for (const provider of signInProviders()) preconnect(SIGN_IN_HOSTS[provider]);
  }, []);

  async function withProvider(provider: Provider) {
    setOpening(provider);
    setError(null);
    // Sends the browser to Google or Apple, which come back here signed in.
    const started = await authClient.signIn
      .social({ provider, callbackURL: window.location.href })
      .then(
        ({ error: failed }) => !failed,
        () => false,
      );
    if (!started) {
      setOpening(null);
      setError(`${NAMES[provider]} sign-in didn’t start. Try again.`);
    }
  }

  async function withPasskey() {
    setChecking(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    setChecking(false);
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
          {providers.map((provider) => (
            <button
              key={provider}
              type="button"
              onClick={() => void withProvider(provider)}
              disabled={busy}
              className={PROVIDER}
            >
              {provider === 'apple' ? <AppleLogo /> : <GoogleLogo />}
              {opening === provider
                ? `Opening ${NAMES[provider]}…`
                : `Continue with ${NAMES[provider]}`}
            </button>
          ))}
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
