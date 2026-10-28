import { useId, type ReactNode } from 'react';
import type { Activity, Category } from '../data/types';
import { glyphBleed } from '../lib/iconMetrics';
import { CATEGORY_ICON } from '../lib/mapPins';
import {
  NEARBY_GROUP_HEADING,
  NEARBY_RADIUS_MILES,
  type NearbyGroup,
} from '../lib/nearbyActivities';
import { CoverImage } from './CoverImage';

/** A Nearby group's heading: its kind's symbol and name, in small capitals. */
export function NearbyHeading({ id, category }: { id: string; category: Category }) {
  return (
    <h4
      id={id}
      className="flex items-center gap-xs font-label-caps text-label-caps text-on-surface-variant"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined"
        style={{ fontSize: 16, marginLeft: glyphBleed(CATEGORY_ICON[category]) }}
      >
        {CATEGORY_ICON[category]}
      </span>
      {NEARBY_GROUP_HEADING[category]}
    </h4>
  );
}

/**
 * A place as a row on a phone (#65, #293): its photo, its name whole, a line
 * of facts under it (`children`), and a chevron. Tapping it opens the place.
 */
export function PlaceRow({
  activity: a,
  onSelect,
  children,
}: {
  activity: Activity;
  onSelect: (activity: Activity) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(a)}
      className="flex min-h-14 w-full items-center gap-sm text-left"
    >
      <span className="block h-14 w-18 shrink-0 overflow-hidden rounded-[10px] bg-surface-variant">
        <CoverImage
          src={a.coverImage}
          alt=""
          category={a.category}
          sizes="72px"
          glyphSize={24}
          className="size-full object-cover"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] leading-snug font-semibold text-on-surface">
          {a.cardName ?? a.name}
        </span>
        <span className="text-[13px] leading-snug text-on-surface-variant">{children}</span>
      </span>
      <span
        className="material-symbols-outlined inline-flex size-5 shrink-0 items-center justify-center overflow-hidden text-[20px] text-outline"
        aria-hidden="true"
      >
        chevron_right
      </span>
    </button>
  );
}

/**
 * A phone's Nearby (#65, as the owners chose over a sideways row): grouped by
 * kind, each place a row with its photo, its name whole, and where it is, how
 * far from here and how long it takes.
 */
export function NearbyList({
  groups,
  city,
  onSelect,
}: {
  groups: readonly NearbyGroup[];
  city: string;
  onSelect: (activity: Activity) => void;
}) {
  const idPrefix = useId();
  return (
    <section aria-label="Nearby" className="space-y-md">
      <div className="space-y-0.5">
        <h3 className="font-display text-[22px] leading-tight font-bold text-primary">Nearby</h3>
        <p className="text-body-sm text-on-surface-variant">
          Within {NEARBY_RADIUS_MILES} miles of {city}
        </p>
      </div>
      {groups.map(({ category, items }) => {
        const headingId = `${idPrefix}-${category}`;
        return (
          <section key={category} aria-labelledby={headingId} className="space-y-sm">
            <NearbyHeading id={headingId} category={category} />
            <ul className="space-y-sm">
              {items.map(({ activity: a, miles }) => (
                <li key={a.id}>
                  <PlaceRow activity={a} onSelect={onSelect}>
                    {a.location.city} · {miles.toFixed(1)} mi · {a.duration}
                  </PlaceRow>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
