import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { authClient } from '../lib/authClient';
import { useAuthState } from '../lib/authShim';
import { passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';

const ACTION =
  'flex min-h-12 w-full items-center gap-sm px-md text-left font-body-md text-body-sm text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50';

/**
 * The signed-in account, in the header: its initial, which opens what can be
 * done with it (add a passkey, so the next sign-in is Face ID or Touch ID;
 * sign out), a card like the sign-in dialog's. The dialog goes to the body,
 * as SignInButton's does.
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
          <ModalShell title="Your account" layout="card" onCancel={() => setOpen(false)}>
            <div className="flex items-center gap-sm p-md pr-lg">
              <span
                aria-hidden="true"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-container font-body-md text-on-primary-container"
              >
                {label.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-body-md text-body-sm font-medium text-on-surface">
                  {name ?? email}
                </p>
                {name && (
                  <p className="truncate font-body-md text-body-sm text-on-surface-variant">
                    {email}
                  </p>
                )}
              </div>
            </div>
            <div className="border-t border-outline-variant/40 py-xs">
              {passkeysSupported() && (
                <button
                  type="button"
                  onClick={() => void addPasskey()}
                  disabled={busy}
                  className={ACTION}
                >
                  <span className="material-symbols-outlined text-icon-md" aria-hidden="true">
                    passkey
                  </span>
                  Add a passkey
                </button>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={busy}
                className={ACTION}
              >
                <span className="material-symbols-outlined text-icon-md" aria-hidden="true">
                  logout
                </span>
                Sign out
              </button>
            </div>
            {note && (
              <p
                role={note.failed ? 'alert' : 'status'}
                className={`border-t border-outline-variant/40 px-md py-sm font-body-md text-body-sm ${note.failed ? 'text-error' : 'text-on-surface-variant'}`}
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
