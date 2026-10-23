import type { ReactNode } from 'react';
import { glyphBleed } from '../lib/iconMetrics';

// A catalog filter chip wrapping a native <select> (distance, duration, …):
// a leading icon, the chosen option's label, and a caret standing in for the
// native arrow.
//
// The chip shows `label` itself and lays the <select> over it, invisible but
// covering the whole chip: a select is as wide as its longest option, so
// showing its own text left a gap before the caret ("Any distance" sized for
// "Within 100 mi of San Jose, CA"). The native picker and the keyboard still
// go to the select, which must name itself with an aria-label.
export function FilterPill({
  icon,
  label,
  children,
}: {
  icon: string;
  /** The text of the option currently chosen in the select. */
  label: string;
  children: ReactNode;
}) {
  return (
    // Even padding; the edge icons are pulled out by their glyphs' empty
    // sides (glyphBleed), so the ink sits at the padding on both ends.
    <label className="relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-xs rounded-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm font-medium text-on-surface transition-colors focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/40 hover:bg-surface-container-low">
      {/* Fixed-size icon box: clips the Material Symbols ligature so a missing
          icon font (the visual tests stub it) can't blow out the chip width. */}
      <span
        className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
        style={{ fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed(icon) }}
        aria-hidden="true"
      >
        {icon}
      </span>
      {/* Hidden from assistive tech: the select, which carries its own
          aria-label, announces the same choice. */}
      <span className="whitespace-nowrap" aria-hidden="true">
        {label}
      </span>
      {/* Custom caret — the native select arrow is removed via appearance-none
          so the chip reads cleanly; this keeps the dropdown affordance. */}
      <span
        className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
        style={{ fontSize: 18, width: 18, height: 18, marginRight: glyphBleed('expand_more') }}
        aria-hidden="true"
      >
        expand_more
      </span>
      <span className="absolute inset-0 overflow-hidden rounded-full [&>select]:size-full [&>select]:cursor-pointer [&>select]:opacity-0">
        {children}
      </span>
    </label>
  );
}
