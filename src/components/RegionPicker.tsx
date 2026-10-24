import { useEffect, useId, useState } from 'react';
import type { Region } from '../data/types';
import {
  californiaLabel,
  californiaOptions,
  loadRegionOptions,
  searchRegions,
  type RegionOption,
} from '../lib/regions';

// Said when nothing matches, by how far the full list got.
const NONE = {
  loading: 'Loading regions…',
  ready: 'No region matches',
  failed: "Couldn't load every region: reopen this form to try again",
} as const;

interface Props {
  /** The field's name. Its own label, outside which the list sits, so the list's text isn't read as part of it. */
  label: string;
  /** The region chosen, or '' for none yet. */
  value: Region | '';
  onChange: (region: Region) => void;
  /** The text inputs' look, so it sits among them. */
  className: string;
}

/**
 * The form's Region field (#274): a search over every region, California's
 * areas and any state, province or country by its ISO code, typed into and
 * picked from a list, with the arrow keys and Enter or by pointer. The full
 * list loads when the field first renders; until it has, or if it can't,
 * California's areas are offered.
 */
export function RegionPicker({ label, value, onChange, className }: Props) {
  const listId = useId();
  const inputId = useId();
  const [options, setOptions] = useState(californiaOptions);
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    loadRegionOptions().then(
      (all) => {
        setOptions(all);
        setLoaded('ready');
      },
      () => setLoaded('failed'),
    );
  }, []);

  const chosen = value
    ? (californiaLabel(value) ?? options.find((o) => o.id === value)?.label ?? value)
    : '';
  // Closing clears the query, so a closed list costs only California's areas.
  const matches = searchRegions(options, query);

  // Keeps the option the keys are on in view in a long list.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId, open]);

  function choose(option: RegionOption) {
    onChange(option.id);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (matches.length ? (i + step + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter' && open) {
      // Picks rather than submitting the form.
      e.preventDefault();
      const option = matches[active];
      if (option) choose(option);
    } else if (e.key === 'Escape' && open) {
      // Closes the list, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-xs block font-body-sm text-on-surface-variant">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search a place, state or country"
          value={open ? query : chosen}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={className}
        />
        {open && (
          <div className="absolute inset-x-0 top-full z-10 mt-xs rounded-md border border-outline-variant bg-surface-container-lowest shadow-lg">
            <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
              {matches.map((option, i) => (
                <li
                  key={option.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // On press, keeping focus in the field: its blur would close
                  // the list before a click landed. The keys are the field's.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-sm py-xs font-body-sm ${
                    i === active ? 'bg-primary-fixed text-on-primary-fixed' : 'text-on-surface'
                  }`}
                >
                  {option.label}
                </li>
              ))}
            </ul>
            {matches.length === 0 && (
              <p role="status" className="px-sm py-xs font-body-sm text-on-surface-variant">
                {NONE[loaded]}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
