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
 * layouts. Frosted pill track with a navy (`primary`) active segment. Rendered
 * only at `lg+` — below the breakpoint Split has no two-column layout, so the
 * mobile UX is a floating "Show map" button (see CuratedAdventures, #96).
 *
 * Accessible as a radiogroup: arrow keys move (and select) between segments,
 * with a roving tabindex so the group is a single tab stop.
 */
export function ViewModeToggle({ value, onChange }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const options = OPTIONS;

  function focusAndSelect(index: number) {
    const next = options[index];
    onChange(next.value);
    refs.current[index]?.focus();
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options.length - 1;
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
      className="inline-flex items-center gap-xs rounded-xl bg-surface-container p-xs"
    >
      {options.map((option, index) => {
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
            className={`flex items-center gap-xs rounded-lg px-sm py-xs text-body-sm font-semibold transition-colors ${
              selected
                ? 'bg-surface-container-lowest text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {/* Fixed-size icon box: Material Symbols renders the glyph via a
                ligature, so if the icon font fails to load (e.g. the visual
                tests stub Google Fonts to empty) the raw ligature *name*
                ("splitscreen", "view_agenda") would otherwise render as text and
                blow out the width of this non-wrapping control. Clipping to a
                fixed box keeps the layout stable in either case. */}
            <span
              className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
              style={{ fontSize: 18, width: 20, height: 20 }}
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
