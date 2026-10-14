import { useEffect, useRef } from 'react';
import { authorLabel } from '../lib/activityReviews';
import { useAddPicker } from '../lib/useAddPicker';

interface Props {
  /** The accounts credited, in order. */
  value: readonly string[];
  /** Every registered account (`users`), the only ones that can be credited. */
  users: readonly string[];
  onChange: (next: string[]) => void;
}

// The server credits at most this many (api/_resolvers/catalog.ts).
const MAX_CONTRIBUTORS = 10;

// Who gets the credit for an activity (#9), in the Add / Edit review step: a
// chip per credited account and a picker of the other registered accounts.
// No free text: the server only credits accounts with a `users` row. The
// last chip can't be removed, since a credited activity keeps at least one.
export function ContributorsField({ value, users, onChange }: Props) {
  const rest =
    value.length < MAX_CONTRIBUTORS ? users.filter((email) => !value.includes(email)) : [];
  // Where focus goes once a change lands: a chip's remove button by email,
  // or '' for the picker; null when no change of ours is landing. The control
  // it was on can unmount under it, which drops focus to <body>; focus that
  // moved on by itself (a pick committed by tabbing away) is left alone. When
  // the target isn't there (a lone chip has no remove button; the accounts
  // haven't loaded), the picker or else the group takes it.
  const focusNext = useRef<string | null>(null);
  const removers = useRef(new Map<string, HTMLButtonElement | null>());
  const pickerRef = useRef<HTMLSelectElement>(null);
  const groupRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === null || document.activeElement !== document.body) return;
    (removers.current.get(target) ?? pickerRef.current ?? groupRef.current)?.focus();
  }, [value]);

  const picker = useAddPicker((email) => {
    focusNext.current = email;
    onChange([...value, email]);
  });
  function remove(email: string) {
    const i = value.indexOf(email);
    const next = value.filter((x) => x !== email);
    // A lone chip left has no remove button, so that falls to the picker.
    focusNext.current = next[i] ?? next[i - 1] ?? '';
    onChange(next);
  }

  return (
    <fieldset ref={groupRef} tabIndex={-1} className="focus:outline-none">
      <legend className="block font-body-sm text-on-surface-variant mb-xs">
        Contributors
      </legend>
      <div className="flex flex-wrap items-center gap-xs">
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex h-9 items-center gap-xs rounded-full bg-surface-container-low border border-outline-variant pl-sm pr-xs text-body-sm"
          >
            {authorLabel(email)}
            {value.length > 1 && (
              <button
                ref={(el) => {
                  removers.current.set(email, el);
                }}
                type="button"
                aria-label={`Remove ${authorLabel(email)}`}
                onClick={() => remove(email)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-variant"
              >
                {/* A fixed box clips the ligature, so a missing icon font
                    can't widen the chip. */}
                <span
                  className="material-symbols-outlined inline-flex h-4 w-4 items-center justify-center overflow-hidden text-[16px]"
                  aria-hidden="true"
                >
                  close
                </span>
              </button>
            )}
          </span>
        ))}
        {rest.length > 0 && (
          <select
            ref={pickerRef}
            aria-label="Add contributor"
            {...picker}
            className="h-9 rounded-full bg-transparent border border-dashed border-outline-variant px-sm text-body-sm cursor-pointer"
          >
            <option value="" disabled>
              + Add contributor
            </option>
            {rest.map((email) => (
              <option key={email} value={email}>
                {authorLabel(email)}
              </option>
            ))}
          </select>
        )}
      </div>
    </fieldset>
  );
}
