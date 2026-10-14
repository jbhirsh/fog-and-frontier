import { useId, useRef, useState } from 'react';
import type { Activity } from '../data/types';
import { CATEGORY_ICON } from '../lib/mapPins';
import {
  TRIP_SUGGESTION_RADIUS_MILES,
  TRIP_SUGGESTIONS_PAGE,
  type TripSuggestion,
} from '../lib/tripSuggestions';
import { CoverImage } from './CoverImage';

interface Props {
  suggestions: readonly TripSuggestion[];
  /** True while another trip action is in flight: Add waits for it. */
  busy: boolean;
  /** Adds the activity as a candidate; resolves true once it's on the trip. */
  onAdd: (activity: Activity) => Promise<boolean>;
  onOpen: (activity: Activity) => void;
}

// "Suggested for this trip" in the voting view (#72): catalog activities near
// the candidates, the trip's missing categories first (see tripSuggestions).
// Each one opens like any activity, or joins the trip as a candidate in one
// tap through the same add-to-trip call the catalog uses.
export function TripSuggestions({ suggestions, busy, onAdd, onOpen }: Props) {
  const [shown, setShown] = useState(TRIP_SUGGESTIONS_PAGE);
  const [added, setAdded] = useState<string | null>(null);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visible = suggestions.slice(0, shown);

  // The added card leaves the list and its new candidate card may be off
  // screen, so say what happened, and keep focus in the section rather than
  // losing it with the card.
  async function add(a: Activity) {
    if (await onAdd(a)) {
      setAdded(`Added ${a.name} as a candidate.`);
      headingRef.current?.focus();
    }
  }

  return (
    <section aria-labelledby={headingId} className="space-y-sm">
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="font-body-lg font-bold text-on-surface focus:outline-none"
      >
        Suggested for this trip
      </h3>
      <p role="status" className="font-body-sm text-primary empty:sr-only">
        {added}
      </p>
      {suggestions.length === 0 ? (
        <p className="font-body-md text-on-surface-variant">
          Nothing else in the catalog is within {TRIP_SUGGESTION_RADIUS_MILES} miles
          of this trip&apos;s candidates.
        </p>
      ) : (
        <>
          <p className="font-body-sm text-on-surface-variant">
            Within {TRIP_SUGGESTION_RADIUS_MILES} miles of the candidates, starting
            with what the trip doesn&apos;t have yet.
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-sm">
            {visible.map(({ activity: a, miles, nearName }) => (
              <li
                key={a.id}
                className="flex items-stretch rounded-lg overflow-hidden border border-outline-variant/40 bg-surface-container-low"
              >
                <button
                  type="button"
                  onClick={() => onOpen(a)}
                  className="flex flex-1 min-w-0 gap-sm items-stretch text-left hover:bg-surface-container transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-container"
                >
                  <span className="relative w-20 min-h-20 shrink-0 bg-surface-variant">
                    <span className="absolute inset-0">
                      <CoverImage
                        src={a.coverImage}
                        alt=""
                        category={a.category}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        glyphSize={28}
                      />
                    </span>
                  </span>
                  <span className="flex-1 min-w-0 py-xs">
                    <span className="block font-body-md font-bold text-on-surface line-clamp-2">
                      {a.name}
                    </span>
                    <span className="flex items-center gap-xs font-body-sm text-on-surface-variant">
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-icon-sm"
                      >
                        {CATEGORY_ICON[a.category]}
                      </span>
                      <span className="truncate">{a.location.city}</span>
                    </span>
                    <span className="block font-body-sm text-on-surface-variant truncate">
                      {miles.toFixed(1)} mi from {nearName}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void add(a)}
                  disabled={busy}
                  aria-label={`Add ${a.name} as a candidate`}
                  className="shrink-0 self-center mx-sm inline-flex items-center justify-center gap-xs rounded-full border border-outline-variant/40 text-primary min-w-11 min-h-11 sm:px-sm font-body-md hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-icon-md">
                    add
                  </span>
                  {/* Icon only on phones, leaving the name room; the label above names it. */}
                  <span aria-hidden="true" className="hidden sm:inline">
                    Add
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {suggestions.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + TRIP_SUGGESTIONS_PAGE)}
              className="min-h-11 text-primary underline font-body-md"
            >
              Show more
            </button>
          )}
        </>
      )}
    </section>
  );
}
