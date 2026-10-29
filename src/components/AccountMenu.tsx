import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { linkMessage, linkResult, withoutLinkResult } from '../lib/accountLinks';
import { authClient } from '../lib/authClient';
import { useAuthState } from '../lib/authShim';
import { deviceName, passkeyAddError, passkeysSupported } from '../lib/passkeys';
import { ModalShell } from './ModalShell';
import { SignInMethods } from './SignInMethods';

const ACTION =
  'flex min-h-12 w-full items-center gap-sm px-md text-left font-body-md text-body-sm text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50';

const ROW_BUTTON =
  'rounded-full px-sm py-xs font-body-md text-body-sm transition-colors hover:bg-surface-container-low disabled:opacity-50';

const dateAdded = (at: Date | string) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The account's passkeys, each by the device that made it, when, and
 * whether it syncs (iCloud Keychain, Google Password Manager), with a
 * Remove that asks first. Mounted only while the menu is open, so the list
 * is read then and not as every page opens.
 */
function PasskeyList() {
  const { data, isPending, error } = authClient.useListPasskeys();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // Removed here, before the list's own refetch says so.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  // The button to give focus to once a row's buttons change under it.
  const list = useRef<HTMLUListElement>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    list.current?.querySelector<HTMLButtonElement>(focusNext.current)?.focus();
    focusNext.current = null;
  });

  function ask(id: string) {
    focusNext.current = `[data-confirm="${id}"]`;
    setConfirming(id);
  }

  function keep(id: string) {
    focusNext.current = `[data-remove="${id}"]`;
    setConfirming(null);
  }

  const passkeys = (data ?? []).filter((passkey) => !removed.has(passkey.id));

  async function remove(id: string) {
    setRemoving(id);
    setFailed(false);
    const result = await authClient.passkey.deletePasskey({ id });
    setRemoving(null);
    setConfirming((now) => (now === id ? null : now));
    if (result.error) {
      // Its buttons go back to Remove: focus follows, unless it's since
      // moved on to another control.
      const active = document.activeElement;
      if (active === document.body || active?.matches(`[data-confirm="${id}"]`)) {
        focusNext.current = `[data-remove="${id}"]`;
      }
      setFailed(true);
      return;
    }
    // Focus goes to the next passkey's Remove (or the one before), or, with
    // none left, to the dialog, rather than to the page under it.
    const at = passkeys.findIndex((passkey) => passkey.id === id);
    const neighbour = passkeys[at + 1] ?? passkeys[at - 1];
    if (neighbour) focusNext.current = `[data-remove="${neighbour.id}"]`;
    else list.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
    setRemoved((now) => new Set(now).add(id));
  }

  const quiet = 'px-md py-sm font-body-md text-body-sm text-on-surface-variant';
  if (isPending) return <p className={quiet}>Loading your passkeys…</p>;
  if (error) return <p className={quiet}>Your passkeys couldn’t be loaded.</p>;
  if (!passkeys.length) {
    return (
      <p className={quiet}>
        No passkeys yet.
        {passkeysSupported() ? ' Add one to sign in with Face ID or Touch ID.' : ''}
      </p>
    );
  }
  return (
    <>
      <ul ref={list} aria-label="Your passkeys">
        {passkeys.map((passkey) => {
          const name = passkey.name || 'Passkey';
          return (
            <li key={passkey.id} className="flex items-center gap-sm px-md py-xs">
              <span
                className="material-symbols-outlined text-icon-md text-on-surface-variant"
                aria-hidden="true"
              >
                passkey
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-body-md text-body-sm text-on-surface">{name}</p>
                {/* Wraps rather than truncates: Remove and Keep leave little room. */}
                <p className="font-body-md text-body-sm text-on-surface-variant">
                  Added {dateAdded(passkey.createdAt)}
                  {passkey.backedUp ? ' · Synced' : ''}
                </p>
              </div>
              {confirming === passkey.id ? (
                <>
                  <button
                    type="button"
                    data-confirm={passkey.id}
                    onClick={() => void remove(passkey.id)}
                    disabled={removing === passkey.id}
                    aria-label={`Yes, remove ${name}`}
                    className={`${ROW_BUTTON} text-error`}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => keep(passkey.id)}
                    disabled={removing === passkey.id}
                    aria-label={`Keep ${name}`}
                    className={`${ROW_BUTTON} text-on-surface-variant`}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-remove={passkey.id}
                  onClick={() => ask(passkey.id)}
                  aria-label={`Remove ${name}, added ${dateAdded(passkey.createdAt)}`}
                  className={`${ROW_BUTTON} text-on-surface-variant`}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="px-md py-xs font-body-md text-body-sm text-error">
          That passkey couldn’t be removed. Try again.
        </p>
      )}
    </>
  );
}

/**
 * The signed-in account, in the header: its initial, which opens what can be
 * done with it (its passkeys, adding one so the next sign-in is Face ID or
 * Touch ID; sign out), a card like the sign-in dialog's. The dialog goes to
 * the body, as SignInButton's does.
 */
export function AccountMenu() {
  const { email, name } = useAuthState();
  const navigate = useNavigate();
  const location = useLocation();
  // Back from connecting Google or Apple (SignInMethods): open, saying how
  // it went, and take the marks out of the address.
  const [arrived] = useState(() => linkResult(location.search));
  const [open, setOpen] = useState(arrived !== null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(() =>
    arrived ? { text: linkMessage(arrived), failed: !arrived.linked } : null,
  );
  useEffect(() => {
    if (!arrived || !linkResult(location.search)) return;
    void navigate(
      {
        pathname: location.pathname,
        search: withoutLinkResult(location.search),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [arrived, location.pathname, location.search, location.hash, navigate]);
  if (!email) return null;
  const label = name ?? email;

  async function addPasskey() {
    setBusy(true);
    setNote(null);
    const result = await authClient.passkey.addPasskey({
      name: deviceName(navigator.userAgent, navigator.maxTouchPoints),
    });
    setBusy(false);
    setNote(
      result.error
        ? {
            text: passkeyAddError(result.error),
            failed: true,
          }
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
            <section
              aria-label="Sign-in methods"
              className="border-t border-outline-variant/40 py-xs"
            >
              <h3 className="px-md pt-xs font-label-caps text-label-caps text-on-surface-variant uppercase">
                Sign-in methods
              </h3>
              <SignInMethods />
            </section>
            <section aria-label="Passkeys" className="border-t border-outline-variant/40 py-xs">
              <h3 className="px-md pt-xs font-label-caps text-label-caps text-on-surface-variant uppercase">
                Passkeys
              </h3>
              <PasskeyList />
            </section>
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
