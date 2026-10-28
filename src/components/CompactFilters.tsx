import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { appliedFilters } from '../lib/catalogFilterOptions';
import { glyphBleed } from '../lib/iconMetrics';
import { usePersonLabel } from '../lib/people';
import { FilterSheet, type FilterSheetProps } from './FilterSheet';

/**
 * The catalog filters on a phone: one Filters button, counting the filters
 * on, that opens them all in a sheet, and beneath it a chip for each filter
 * on, which takes it off. It replaced a row of pickers that scrolled
 * sideways, too many to take in on a small screen.
 *
 * The root is `display: contents`, so the button and the chips sit in the
 * caller's flex row, the chips on a line of their own after everything
 * else (`order-last`). In the header's row (`inHeader`) the button is 44px
 * tall like the rest of it, a symbol and its count below lg, and the
 * chips go to `chipsIn`, a row of their own under the header.
 */
export function CompactFilters({
  className = '',
  inHeader = false,
  chipsIn,
  ...sheet
}: FilterSheetProps & {
  className?: string;
  inHeader?: boolean;
  chipsIn?: HTMLElement | null;
}) {
  const authorLabel = usePersonLabel();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const on = appliedFilters(sheet.values, authorLabel);

  // A removed chip unmounts under focus (only a chip's own press removes
  // it), which drops it to <body>: move it on to the chip that took its
  // place, the one before it, or the button.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chips = useRef(new Map<string, HTMLButtonElement | null>());
  const focusNext = useRef<string | null>(null);
  const keys = on.map((f) => f.key).join('|');
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === null) return;
    (chips.current.get(target) ?? buttonRef.current)?.focus();
  }, [keys]);

  function remove(index: number) {
    const rest = on.filter((_, i) => i !== index);
    focusNext.current = (rest[index] ?? rest[index - 1])?.key ?? '';
    sheet.onChange(on[index].off);
  }

  // A chip for each filter on, which takes it off: on a line of their own in
  // the caller's row, or centred in the row under the header.
  const chipList = on.length > 0 && (
    <FilterChips
      on={on}
      onRemove={remove}
      register={(key, el) => {
        chips.current.set(key, el);
      }}
      className={chipsIn === undefined ? 'order-last w-full' : 'mx-auto max-w-screen-2xl'}
    />
  );

  return (
    <div className={`contents ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={on.length > 0 ? `Filters, ${on.length} on` : 'Filters'}
        className={`inline-flex shrink-0 items-center gap-xs rounded-full border border-primary bg-surface-container-lowest text-body-sm font-semibold text-primary transition-colors hover:bg-surface-container-low ${
          inHeader ? 'relative size-11 justify-center lg:w-auto lg:px-sm' : 'h-9 px-sm'
        }`}
      >
        <span
          className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
          style={
            inHeader
              ? { fontSize: 20, width: 20, height: 20 }
              : { fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed('tune') }
          }
          aria-hidden="true"
        >
          tune
        </span>
        <span className={inHeader ? 'hidden lg:inline' : undefined}>Filters</span>
        {on.length > 0 && (
          <span
            aria-hidden="true"
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-[5px] leading-none text-on-primary tabular-nums ${
              // On the symbol alone, below lg, its count sits on the corner.
              inHeader ? 'max-lg:absolute max-lg:-top-1 max-lg:-right-1' : ''
            }`}
          >
            {on.length}
          </span>
        )}
      </button>
      {chipsIn === undefined ? chipList : chipsIn && chipList && createPortal(chipList, chipsIn)}
      {/* On <body>: the toolbar and the map's list sheet are frosted, and a
          backdrop-filter makes an element the box a fixed child is placed
          in, which would shut the sheet inside them. */}
      {open && createPortal(<FilterSheet {...sheet} onClose={close} />, document.body)}
    </div>
  );
}

/** The chips for the filters on; `register` keeps each chip's element by its key. */
function FilterChips({
  on,
  onRemove,
  register,
  className,
}: {
  on: ReturnType<typeof appliedFilters>;
  onRemove: (index: number) => void;
  register: (key: string, el: HTMLButtonElement | null) => void;
  className: string;
}) {
  return (
    <ul aria-label="Filters on" className={`flex flex-wrap gap-xs ${className}`}>
      {on.map((filter, i) => (
        <li key={filter.key}>
          <button
            ref={(el) => register(filter.key, el)}
            type="button"
            aria-label={`Remove filter: ${filter.label}`}
            onClick={() => onRemove(i)}
            className="inline-flex h-8 items-center gap-xs rounded-full bg-primary-fixed pr-base pl-sm text-body-sm font-medium text-on-primary-fixed transition-colors hover:bg-primary-fixed-dim"
          >
            {filter.label}
            <span
              className="material-symbols-outlined inline-flex size-4 shrink-0 items-center justify-center overflow-hidden text-[16px]"
              aria-hidden="true"
            >
              close
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
