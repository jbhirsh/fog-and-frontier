import type { ReactNode } from 'react';

// A catalog filter chip wrapping a native <select> (distance, duration, …):
// a leading icon, the control, and a caret standing in for the native arrow.
export function FilterPill({
  icon,
  children,
}: {
  icon: string;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex h-9 shrink-0 items-center gap-xs rounded-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm font-medium text-on-surface hover:bg-surface-container-low transition-colors cursor-pointer focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/40">
      {/* Fixed-size icon box: clips the Material Symbols ligature so a missing
          icon font (the visual tests stub it) can't blow out the chip width. */}
      <span
        className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
        style={{ fontSize: 18, width: 18, height: 18 }}
        aria-hidden="true"
      >
        {icon}
      </span>
      {children}
      {/* Custom caret — the native select arrow is removed via appearance-none
          so the chip reads cleanly; this keeps the dropdown affordance. */}
      <span
        className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
        style={{ fontSize: 18, width: 18, height: 18 }}
        aria-hidden="true"
      >
        expand_more
      </span>
    </label>
  );
}
