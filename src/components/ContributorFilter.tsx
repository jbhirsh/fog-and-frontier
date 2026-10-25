import { useEffect, useRef } from 'react';
import { usePersonLabel } from '../lib/people';
import { useAddPicker } from '../lib/useAddPicker';
import { FilterPill } from './FilterPill';
import { glyphBleed } from '../lib/iconMetrics';

interface Props {
  /** Every account credited in the catalog. */
  options: readonly string[];
  /** The accounts the list is filtered to; empty for anyone's. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

// The Contributors filter (#9): a chip per chosen account that takes it off
// again, then a picker that adds one. An activity shows when any chosen
// account added it. The chips come first so a new one lands where the
// picker was, in view even in the sideways-scrolling mobile row.
export function ContributorFilter({ options, selected, onChange }: Props) {
  const authorLabel = usePersonLabel();
  const rest = options.filter((e) => !selected.includes(e));
  // Where focus goes once a change lands: a chip's email, '' for the picker.
  // A removed chip, or the picker after its last name, unmounts under focus,
  // which drops it to <body>; focus that moved on by itself (a pick committed
  // by tabbing away) is left where it went.
  // Null when no change of ours is landing (the first render, Back).
  const focusNext = useRef<string | null>(null);
  const chips = useRef(new Map<string, HTMLButtonElement | null>());
  const pickerRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === null || document.activeElement !== document.body) return;
    (target === '' ? pickerRef.current : chips.current.get(target))?.focus();
  }, [selected]);

  const picker = useAddPicker((email) => {
    // Only acted on if the picker unmounts (its last name) under focus.
    focusNext.current = email;
    onChange([...selected, email]);
  });
  function remove(email: string) {
    const i = selected.indexOf(email);
    const next = selected.filter((x) => x !== email);
    focusNext.current = next[i] ?? next[i - 1] ?? '';
    onChange(next);
  }

  return (
    <>
      {selected.map((email) => (
        <button
          key={email}
          ref={(el) => {
            chips.current.set(email, el);
          }}
          type="button"
          aria-label={`Remove contributor filter: ${authorLabel(email)}`}
          onClick={() => remove(email)}
          className="inline-flex h-9 shrink-0 items-center gap-xs rounded-full border border-primary bg-primary px-sm text-body-sm font-medium text-on-primary transition-colors"
        >
          <span
            className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
            style={{ fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed('person') }}
            aria-hidden="true"
          >
            person
          </span>
          {authorLabel(email)}
          <span
            className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
            style={{ fontSize: 18, width: 18, height: 18, marginRight: glyphBleed('close') }}
            aria-hidden="true"
          >
            close
          </span>
        </button>
      ))}
      {rest.length > 0 && (
        <FilterPill
          icon="person"
          label={selected.length > 0 ? 'Add contributor' : 'Any contributor'}
        >
          <select
            ref={pickerRef}
            aria-label="Contributed by"
            {...picker}
            className="cursor-pointer appearance-none bg-transparent text-body-sm focus:outline-none"
          >
            <option value="" disabled>
              {selected.length > 0 ? 'Add contributor' : 'Any contributor'}
            </option>
            {rest.map((email) => (
              <option key={email} value={email}>
                {authorLabel(email)}
              </option>
            ))}
          </select>
        </FilterPill>
      )}
    </>
  );
}
