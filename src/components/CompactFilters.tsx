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
 * else (`order-last`). `className` hides it where the pickers show instead.
 */
export function CompactFilters({
  className = '',
  ...sheet
}: FilterSheetProps & { className?: string }) {
  const authorLabel = usePersonLabel();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
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

  return (
    <div className={`contents ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={on.length > 0 ? `Filters, ${on.length} on` : 'Filters'}
        className="inline-flex h-9 shrink-0 items-center gap-xs rounded-full border border-primary bg-surface-container-lowest px-sm text-body-sm font-semibold text-primary transition-colors hover:bg-surface-container-low"
      >
        <span
          className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
          style={{ fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed('tune') }}
          aria-hidden="true"
        >
          tune
        </span>
        Filters
        {on.length > 0 && (
          <span
            aria-hidden="true"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-[5px] leading-none text-on-primary tabular-nums"
          >
            {on.length}
          </span>
        )}
      </button>
      {on.length > 0 && (
        <ul aria-label="Filters on" className="order-last flex w-full flex-wrap gap-xs">
          {on.map((filter, i) => (
            <li key={filter.key}>
              <button
                ref={(el) => {
                  chips.current.set(filter.key, el);
                }}
                type="button"
                aria-label={`Remove filter: ${filter.label}`}
                onClick={() => remove(i)}
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
      )}
      {/* On <body>: the toolbar and the map's list sheet are frosted, and a
          backdrop-filter makes an element the box a fixed child is placed
          in, which would shut the sheet inside them. */}
      {open && createPortal(<FilterSheet {...sheet} onClose={close} />, document.body)}
    </div>
  );
}
