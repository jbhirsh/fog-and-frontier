import { useRef, useState } from 'react';
import { InlineError } from './InlineError';

// Local type — a parallel task adds this to userTrips.ts; importing it from
// there would create a race condition on the branch.
type UserSummary = { email: string; display_name: string | null };

type Props = {
  users: UserSummary[];
  excludeEmails: string[];
  onClose: () => void;
  onCreateInvite: (email: string) => Promise<{ invite_token: string }>;
  buildLink: (inviteToken: string) => string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteModal({
  users,
  excludeEmails,
  onClose,
  onCreateInvite,
  buildLink,
}: Props) {
  const [query, setQuery] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const excludeLower = excludeEmails.map((e) => e.toLowerCase());

  const suggestions =
    query.trim().length > 0
      ? users.filter((u) => {
          if (excludeLower.includes(u.email.toLowerCase())) return false;
          const q = query.toLowerCase();
          return (
            u.email.toLowerCase().includes(q) ||
            (u.display_name?.toLowerCase().includes(q) ?? false)
          );
        })
      : [];

  function handleSelectSuggestion(u: UserSummary) {
    setEmail(u.email);
    setQuery('');
    inputRef.current?.focus();
  }

  async function handleCreate() {
    if (busy) return;
    setError(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const { invite_token } = await onCreateInvite(trimmed);
      setCreatedToken(invite_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!createdToken) return;
    const link = buildLink(createdToken);
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Could not copy to clipboard — please copy the link manually.');
      }
    } else {
      setError('Clipboard not available — please copy the link manually.');
    }
  }

  function handleInviteAnother() {
    setCreatedToken(null);
    setEmail('');
    setQuery('');
    setError(null);
    setCopied(false);
  }

  const inviteLink = createdToken ? buildLink(createdToken) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-margin">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite to this trip"
        className="relative w-full max-w-2xl bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-xl p-lg space-y-md"
      >
        <h2 className="font-headline-md text-headline-md text-on-surface">
          Invite to this trip
        </h2>

        {createdToken ? (
          /* ── Link-ready state ── */
          <div className="space-y-md">
            <p className="font-body-md text-on-surface-variant">
              Anyone signed in who opens this link joins the trip as an editor.
            </p>

            <div className="flex items-center gap-sm">
              <input
                type="text"
                readOnly
                value={inviteLink ?? ''}
                className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm font-body-md text-on-surface"
              />
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="shrink-0 bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>

            <InlineError message={error} onDismiss={() => setError(null)} />

            <div className="flex items-center justify-end gap-md">
              <button
                type="button"
                onClick={handleInviteAnother}
                className="font-body-md text-on-surface-variant"
              >
                Invite someone else
              </button>
              <button
                type="button"
                onClick={onClose}
                className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Input state ── */
          <div className="space-y-md">
            <p className="font-body-md text-on-surface-variant">
              Anyone signed in who opens this link joins the trip as an editor.
            </p>

            <div className="relative space-y-xs">
              <label
                htmlFor="invite-email-input"
                className="block font-body-md text-on-surface-variant"
              >
                Email address
              </label>
              <input
                id="invite-email-input"
                ref={inputRef}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setQuery(e.target.value);
                  setError(null);
                }}
                placeholder="name@example.com"
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm font-body-md text-on-surface"
              />

              {suggestions.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Email suggestions"
                  className="absolute z-10 w-full mt-xs bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-lg overflow-hidden"
                >
                  {suggestions.map((u) => (
                    <li key={u.email} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => handleSelectSuggestion(u)}
                        className="w-full text-left px-md py-sm hover:bg-surface-variant font-body-md"
                      >
                        <span className="block text-on-surface">
                          {u.display_name ?? u.email}
                        </span>
                        {u.display_name && (
                          <span className="block text-sm text-on-surface-variant">
                            {u.email}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <InlineError message={error} onDismiss={() => setError(null)} />

            <div className="flex items-center justify-end gap-md">
              <button
                type="button"
                onClick={onClose}
                className="font-body-md text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={busy}
                className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? 'Creating…' : 'Create invite link'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
