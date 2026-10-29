import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { authClient } from '../lib/authClient';
import { useAuthState } from '../lib/authShim';
import { passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';

const ACTION =
  'flex min-h-12 w-full items-center justify-center rounded-full border border-outline-variant px-md font-body-md text-on-surface transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * The signed-in account, in the header: its initial, which opens what can be
 * done with it (add a passkey, so the next sign-in is Face ID or Touch ID;
 * sign out). The dialog goes to the body, as SignInButton's does.
 */
export function AccountMenu() {
  const { email, name } = useAuthState();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  if (!email) return null;
  const label = name ?? email;

  async function addPasskey() {
    setBusy(true);
    setNote(null);
    const result = await authClient.passkey.addPasskey();
    setBusy(false);
    setNote(
      result?.error
        ? { text: 'No passkey was added.', failed: true }
        : { text: 'Passkey added. Next time, sign in with it.', failed: false },
    );
  }

  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    setBusy(false);
    setOpen(false);
    void navigate('/');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNote(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={`Your account: ${label}`}
        className="inline-flex size-11 items-center justify-center rounded-full bg-primary-container font-body-md text-on-primary-container"
      >
        {label.charAt(0).toUpperCase()}
      </button>
      {open &&
        createPortal(
          <ModalShell title="Your account" onCancel={() => setOpen(false)}>
            <p className="font-body-md text-on-surface-variant">
              Signed in as {name ? `${name} (${email})` : email}
            </p>
            <div className="space-y-sm">
              {passkeysSupported() && (
                <button
                  type="button"
                  onClick={() => void addPasskey()}
                  disabled={busy}
                  className={ACTION}
                >
                  Add a passkey
                </button>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={busy}
                className={ACTION}
              >
                Sign out
              </button>
            </div>
            {note && (
              <p
                role={note.failed ? 'alert' : 'status'}
                className={`font-body-md ${note.failed ? 'text-error' : 'text-on-surface-variant'}`}
              >
                {note.text}
              </p>
            )}
          </ModalShell>,
          document.body,
        )}
    </>
  );
}
