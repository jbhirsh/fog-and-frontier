import { useId, useState } from 'react';
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
  onAdd: (activity: Activity) => void;
  onOpen: (activity: Activity) => void;
}

// "Suggested for this trip" in the voting view (#72): catalog activities near
// the candidates, the trip's missing categories first (see tripSuggestions).
// Each one opens like any activity, or joins the trip as a candidate in one
// tap through the same add-to-trip call the catalog uses.
export function TripSuggestions({ suggestions, busy, onAdd, onOpen }: Props) {
  const [shown, setShown] = useState(TRIP_SUGGESTIONS_PAGE);
  const headingId = useId();
  const visible = suggestions.slice(0, shown);

  return (
    <section aria-labelledby={headingId} className="space-y-sm">
      <h3 id={headingId} className="font-headline-md text-headline-md text-on-surface">
        Suggested for this trip
      </h3>
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
                  className="flex flex-1 min-w-0 gap-sm items-stretch text-left hover:bg-surface-container transition-colors"
                >
                  <div className="w-20 shrink-0 bg-surface-variant">
                    <CoverImage
                      src={a.coverImage}
                      alt=""
                      category={a.category}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      glyphSize={28}
                    />
                  </div>
                  <div className="flex-1 min-w-0 py-xs">
                    <div className="font-body-md font-bold text-on-surface truncate">
                      {a.name}
                    </div>
                    <div className="flex items-center gap-xs font-body-sm text-on-surface-variant truncate">
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-body-md"
                      >
                        {CATEGORY_ICON[a.category]}
                      </span>
                      <span className="truncate">{a.location.city}</span>
                    </div>
                    <div className="font-body-sm text-on-surface-variant truncate">
                      {miles.toFixed(1)} mi from {nearName}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onAdd(a)}
                  disabled={busy}
                  aria-label={`Add ${a.name} as a candidate`}
                  className="shrink-0 self-center mx-sm inline-flex items-center gap-xs rounded-full border border-outline-variant/40 text-primary px-sm min-h-11 font-body-md hover:bg-surface-variant disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-body-md">
                    add
                  </span>
                  Add
                </button>
              </li>
            ))}
          </ul>
          {suggestions.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + TRIP_SUGGESTIONS_PAGE)}
              className="text-primary underline font-body-md"
            >
              Show more
            </button>
          )}
        </>
      )}
    </section>
  );
}
