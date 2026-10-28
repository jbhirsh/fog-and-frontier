import type { ReactNode } from 'react';
import type { Activity } from '../data/types';
import { parkSectionId } from '../lib/parks';

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
 * A park's hikes and stops, opened from the count on its stack (#269): a
 * full-width section under the park's row, holding the park's own cards.
 */
export function ParkSection({ park, children, gridClass, onViewPark, onClose }: SectionProps) {
  const headingId = `${parkSectionId(park.id)}-heading`;
  return (
    <section
      id={parkSectionId(park.id)}
      aria-labelledby={headingId}
      className="col-span-full flex flex-col gap-sm rounded-2xl bg-surface-container p-sm md:gap-md md:rounded-[24px] md:p-md"
    >
      <div className="flex items-center gap-xs">
        {/* Not a heading: one would hold every card after it in the outline.
            It shows the park's name alone, as the stack it opened from says
            what these are; a reader still hears the whole. */}
        <p
          id={headingId}
          className="min-w-0 flex-1 font-display text-[18px] leading-snug font-semibold text-primary"
        >
          <span className="sr-only">Hikes &amp; stops in</span> {park.name}
        </p>
        <button
          type="button"
          onClick={onViewPark}
          className="inline-flex min-h-11 shrink-0 items-center gap-xs rounded-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm font-semibold whitespace-nowrap text-primary hover:bg-surface-container-low"
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
          className="-mr-xs inline-flex size-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
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
