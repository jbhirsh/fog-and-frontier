import { useEffect, useRef, useState } from 'react';
import type { Activity } from '../data/types';
import { directionsUrl, isApplePlatform } from '../lib/directions';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import { CoverImage } from './CoverImage';
import { DogIcon } from './DogIcon';

// What a place is, in a word, for the card's line under its name.
const KIND: Record<Activity['category'], string> = {
  hiking: 'Hike',
  cycling: 'Ride',
  water: 'Water',
  food: 'Food',
  culture: 'Culture',
  scenic: 'Scenic',
  climbing: 'Climb',
  camping: 'Camping',
  other: 'Other',
};

interface Props {
  activity: Activity;
  /** Open the full detail, as tapping a card does. */
  onDetails: () => void;
  onClose: () => void;
}

/**
 * The card a tapped pin shows on the mobile map (#291), over the list sheet
 * and above the tab bar: the place at a glance, with directions and the way
 * into its detail. A tap on the map, ✕ or Escape puts it away.
 *
 * It takes focus as it opens, so a keyboard reaches it, and gives it back to
 * what had it (the pin) as it goes, unless a tap elsewhere has moved it on.
 * See details hands it back first, so the detail returns there too.
 */
export function PinCard({ activity, onDetails, onClose }: Props) {
  const distance = useDistanceTo()(activity);
  const directions = directionsUrl(activity.location.coords, isApplePlatform());
  const name = activity.cardName ?? activity.name;
  const heading = useRef<HTMLHeadingElement>(null);
  // What had focus before the card, read as it first renders: before its
  // effect moves focus in, which StrictMode runs twice.
  const [opener] = useState(() => {
    const had = document.activeElement;
    return had instanceof HTMLElement && had !== document.body ? had : null;
  });

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    return () => {
      // Focus left with the card (✕, Escape): back to the opener.
      const now = document.activeElement;
      if ((now === null || now === document.body) && opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [opener]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape in a field or another dialog is theirs (clearing the search,
      // closing a menu), not the card's.
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [role="dialog"], [role="menu"]')) return;
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function openDetails() {
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    onDetails();
  }

  return (
    <section
      aria-label={activity.name}
      // A tablet has no tab bar under it, so it clears the home indicator.
      className="fixed inset-x-0 bottom-(--tab-bar) z-61 px-margin pb-sm md:pb-[calc(var(--spacing-sm)+env(safe-area-inset-bottom))]"
    >
      <div className="relative rounded-2xl bg-surface-container-lowest p-sm shadow-[0_8px_30px_rgba(0,30,55,0.22)]">
        <div className="flex gap-sm">
          <div className="size-18 shrink-0 overflow-hidden rounded-xl bg-surface-variant">
            <CoverImage
              alt=""
              category={activity.category}
              className="size-full object-cover"
              src={activity.coverImage}
              glyphSize={28}
              sizes="72px"
            />
          </div>
          <div className="min-w-0 flex-1">
            {/* Clear of the close button, which sits over its corner. */}
            <h2
              ref={heading}
              tabIndex={-1}
              className="pr-8 text-[15px] leading-snug font-semibold text-on-surface focus:outline-none"
            >
              {name}
            </h2>
            <p className="text-body-sm text-on-surface-variant">
              {KIND[activity.category]} · {activity.duration}
            </p>
            <p className="flex flex-wrap items-center gap-x-sm text-body-sm text-on-surface-variant">
              <span>
                {activity.location.city} · {formatMiles(distance)} mi
              </span>
              {activity.allTrailsRating != null && (
                <span className="flex items-center gap-0.5">
                  <span
                    className="material-symbols-outlined size-4 overflow-hidden text-[16px] text-secondary"
                    aria-hidden="true"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    star
                  </span>
                  <span className="sr-only">Rated </span>
                  {activity.allTrailsRating.toFixed(1)}
                </span>
              )}
              {activity.dogFriendly && (
                <span role="img" aria-label="Dogs welcome" className="text-on-surface">
                  <DogIcon size={18} />
                </span>
              )}
            </p>
          </div>
        </div>
        {/* The card's whole width, half each, so neither label wraps. */}
        <div className="mt-sm flex gap-sm">
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-xs rounded-full border border-outline-variant text-body-sm font-medium whitespace-nowrap text-on-surface hover:bg-surface-variant"
            >
              <span
                className="material-symbols-outlined size-4.5 overflow-hidden text-[18px]"
                aria-hidden="true"
              >
                directions
              </span>
              Directions
            </a>
          )}
          <button
            type="button"
            onClick={openDetails}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-primary text-body-sm font-semibold whitespace-nowrap text-on-primary hover:opacity-90"
          >
            See details
          </button>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant"
        >
          <span
            className="material-symbols-outlined size-5 overflow-hidden text-[20px]"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </div>
    </section>
  );
}
