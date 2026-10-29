import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { authClient } from '../lib/authClient';
import { passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';

const OPTION =
  'flex min-h-12 w-full items-center justify-center gap-sm rounded-full px-md font-body-md transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * Signing in: with Google, which comes back to this page, or with a passkey
 * made earlier from the account menu (AccountMenu).
 */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withGoogle() {
    setBusy(true);
    setError(null);
    // Sends the browser to Google, which comes back here signed in.
    const { error: failed } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: window.location.href,
    });
    if (failed) {
      setBusy(false);
      setError('Google sign-in didn’t start. Try again.');
    }
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    setBusy(false);
    if (result?.error) {
      setError(
        'That passkey didn’t sign you in. Try Google, then add a passkey from your account.',
      );
      return;
    }
    onClose();
  }

  return (
    <ModalShell title="Sign in" onCancel={onClose}>
      <div className="space-y-sm">
        <button
          type="button"
          onClick={() => void withGoogle()}
          disabled={busy}
          className={`${OPTION} bg-primary text-on-primary`}
        >
          Continue with Google
        </button>
        {passkeysSupported() && (
          <button
            type="button"
            onClick={() => void withPasskey()}
            disabled={busy}
            className={`${OPTION} border border-outline-variant text-on-surface`}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              passkey
            </span>
            Sign in with a passkey
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="font-body-md text-error">
          {error}
        </p>
      )}
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
