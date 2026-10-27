import type { ReactNode } from 'react';
import type { Activity } from '../data/types';
import { glyphBleed } from '../lib/iconMetrics';
import { parkBarId, parkSectionId, subItemsLabel } from '../lib/parks';

interface BarProps {
  park: Activity;
  count: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * The bar under a park's card from md up (#269): how many of its hikes and
 * stops the list holds, opening the section that shows them.
 */
export function ParkBar({ park, count, open, onToggle }: BarProps) {
  const icon = open ? 'expand_less' : 'expand_more';
  return (
    <button
      type="button"
      id={parkBarId(park.id)}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? parkSectionId(park.id) : undefined}
      aria-label={`${subItemsLabel(count)} in ${park.name}`}
      // From md up only: a phone's park card is a stack, its count on the
      // photo (ActivityCard's stack).
      className={`flex min-h-11 w-full items-center justify-between rounded-[14px] border px-md text-body-sm font-semibold text-primary transition-colors ${
        open
          ? 'border-primary bg-primary-fixed'
          : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
      }`}
    >
      <span className="flex items-center gap-sm">
        <span
          className="material-symbols-outlined text-secondary"
          aria-hidden="true"
          style={{ fontSize: 18, marginLeft: glyphBleed('account_tree') }}
        >
          account_tree
        </span>
        {subItemsLabel(count)}
      </span>
      <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 22 }}>
        {icon}
      </span>
    </button>
  );
}

interface SectionProps {
  park: Activity;
  /** Its hikes and stops as cards, in the list's order. */
  children: ReactNode;
  /** Their grid's columns, which depend on the view the list is in. */
  gridClass: string;
  onViewPark: () => void;
  onClose: () => void;
}

/**
 * A park's hikes and stops, opened from its bar (#269): a full-width
 * section under the park's row, holding the park's own cards.
 */
export function ParkSection({ park, children, gridClass, onViewPark, onClose }: SectionProps) {
  const headingId = `${parkSectionId(park.id)}-heading`;
  return (
    <section
      id={parkSectionId(park.id)}
      aria-labelledby={headingId}
      className="col-span-full flex flex-col gap-sm rounded-2xl bg-surface-container p-sm md:gap-md md:rounded-[24px] md:p-md"
    >
      <div className="flex items-center gap-xs md:flex-wrap md:gap-sm">
        {/* Not a heading: one would hold every card after it in the outline.
            A phone shows the park's name alone, as its bar above says what
            these are; a reader still hears the whole. */}
        <p
          id={headingId}
          className="min-w-0 flex-1 font-display text-[18px] leading-snug font-semibold text-primary md:text-headline-md md:leading-[1.3]"
        >
          <span className="sr-only md:not-sr-only">Hikes &amp; stops in</span> {park.name}
        </p>
        <button
          type="button"
          onClick={onViewPark}
          className="inline-flex min-h-11 shrink-0 items-center gap-xs rounded-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm font-semibold whitespace-nowrap text-primary hover:bg-surface-container-low md:px-md"
        >
          View park
          <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
            arrow_forward
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${park.name}'s hikes and stops`}
          className="-mr-xs inline-flex size-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high md:mr-0"
        >
          <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 22 }}>
            close
          </span>
        </button>
      </div>
      <div className={`grid gap-x-sm gap-y-md md:gap-gutter ${gridClass}`}>{children}</div>
    </section>
  );
}
