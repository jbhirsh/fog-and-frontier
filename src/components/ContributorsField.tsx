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
      <legend className="mb-xs block font-body-sm text-on-surface-variant">Contributors</legend>
      <div className="flex flex-wrap items-center gap-xs">
        {value.map((email) => (
          <span
            key={email}
            // The remove button brings its own room on the right; a lone chip
            // has none, so it pads both sides alike.
            className={`inline-flex h-9 items-center gap-xs rounded-full border border-outline-variant bg-surface-container-low pl-sm ${value.length > 1 ? 'pr-xs' : 'pr-sm'} text-body-sm`}
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
                className="inline-flex size-7 items-center justify-center rounded-full hover:bg-surface-variant"
              >
                {/* Sized inline, as in FilterPill: the icon font's own rule
                    outranks Tailwind's size utilities. The fixed box clips
                    the ligature, so a missing icon font can't widen the chip. */}
                <span
                  className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
                  style={{ fontSize: 18, width: 18, height: 18 }}
                  aria-hidden="true"
                >
                  close
                </span>
              </button>
            )}
          </span>
        ))}
        {rest.length > 0 && (
          // The native arrow ignores the select's padding and sits on the
          // border, so it's hidden and drawn as a caret, as in FilterPill.
          // The caret's glyph sits ~5px inside its box, so the right padding
          // is trimmed to match the label's inset on the left.
          <label className="inline-flex h-9 cursor-pointer items-center gap-xs rounded-full border border-dashed border-outline-variant pr-[9px] pl-sm text-body-sm transition-colors focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/40 hover:bg-surface-container-low">
            <select
              ref={pickerRef}
              aria-label="Add contributor"
              {...picker}
              className="cursor-pointer appearance-none bg-transparent focus:outline-none"
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
            <span
              className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
              style={{ fontSize: 18, width: 18, height: 18 }}
              aria-hidden="true"
            >
              expand_more
            </span>
          </label>
        )}
      </div>
    </fieldset>
  );
}
