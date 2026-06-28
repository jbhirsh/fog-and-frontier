import { useRef } from 'react';

/**
 * The three layout modes of the combined Curated + Map surface (#4 / #93):
 * a full-width list, a list/map split, and a full-width map.
 */
export type ViewMode = 'list' | 'split' | 'map';

type Option = { value: ViewMode; label: string; icon: string };

// Order matters: the segmented control reads List · Split · Map left-to-right,
// and left/right arrow navigation walks this array.
const OPTIONS: readonly Option[] = [
  { value: 'list', label: 'List', icon: 'view_agenda' },
  { value: 'split', label: 'Split', icon: 'splitscreen' },
  { value: 'map', label: 'Map', icon: 'map' },
];

type Props = {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
};

/**
 * iOS-style segmented control for switching between the List · Split · Map
 * layouts. Frosted pill track with a navy (`primary`) active segment.
 *
 * Accessible as a radiogroup: arrow keys move (and select) between segments,
 * with a roving tabindex so the group is a single tab stop.
 */
export function ViewModeToggle({ value, onChange }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusAndSelect(index: number) {
    const next = OPTIONS[index];
    onChange(next.value);
    refs.current[index]?.focus();
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % OPTIONS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = OPTIONS.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      focusAndSelect(nextIndex);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="inline-flex items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-lowest/70 p-xs backdrop-blur-xl"
    >
      {OPTIONS.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex items-center gap-xs rounded-full px-sm py-xs font-label-caps text-label-caps uppercase transition-colors ${
              selected
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-variant/60'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
              aria-hidden="true"
            >
              {option.icon}
            </span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
