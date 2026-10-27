import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity } from '../data/types';
import { kindLabel } from '../lib/activityLabels';
import { directionsUrl, isApplePlatform } from '../lib/directions';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import { useCompleted } from '../lib/userCompleted';
import { useOwner } from '../lib/useOwner';
import { CoverImage } from './CoverImage';
import { DogIcon } from './DogIcon';

// A place's page on a phone (#293): the pieces ActivityDetail lays out below
// md, saying the same as the desktop dialog in less: a shorter photo, the
// facts on one line in symbols where they're clear, the three things to do
// in a row, and the rest of the catalog sideways.

/**
 * The dog's head for a dog-friendly place (#296), beside its name: a 44px
 * link to its dog rules when it has a page for them, else the symbol alone.
 * Nothing for a place dogs aren't welcome at.
 */
export function DogRulesLink({ activity }: { activity: Activity }) {
  if (!activity.dogFriendly) return null;
  const face = (
    <span className="inline-flex size-8 items-center justify-center rounded-full bg-surface-container-low text-primary">
      <DogIcon size={22} />
    </span>
  );
  if (!activity.dogRulesUrl) {
    return (
      <span
        role="img"
        aria-label="Dogs welcome"
        className="-mt-1.5 -mr-1.5 inline-flex size-11 shrink-0 items-center justify-center"
      >
        {face}
      </span>
    );
  }
  return (
    <a
      href={activity.dogRulesUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Dogs welcome: ${activity.name}'s dog rules (opens in a new tab)`}
      className="-mt-1.5 -mr-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-low"
    >
      {face}
    </a>
  );
}

/** The 250px photo at the top, with whatever buttons sit over it. */
export function PhoneCover({ activity, children }: { activity: Activity; children?: ReactNode }) {
  return (
    <div className="relative h-62.5 bg-surface-variant">
      <CoverImage
        alt={activity.name}
        category={activity.category}
        src={activity.coverImage}
        className="size-full object-cover"
        glyphSize={56}
        sizes="100vw"
      />
      {children}
    </div>
  );
}

const DOT = (
  <span aria-hidden="true" className="text-outline">
    ·
  </span>
);

/**
 * The name, whole, with the dog beside it; the park and town under it; and
 * the facts on one line: kind · duration · distance · ★ rating · cost.
 */
export function PhoneHeading({
  activity,
  park,
  onOpenPark,
}: {
  activity: Activity;
  park: Activity | undefined;
  onOpenPark?: (park: Activity) => void;
}) {
  const distance = useDistanceTo()(activity);
  const cost = activity.costTier === 'free' ? 'Free' : activity.costTier;
  const facts = [
    kindLabel(activity.category),
    activity.duration,
    <>
      {formatMiles(distance)} mi<span className="sr-only"> away</span>
    </>,
    activity.allTrailsRating != null && (
      <span className="inline-flex items-center gap-0.5">
        <span
          className="material-symbols-outlined size-3.5 overflow-hidden text-[14px]"
          aria-hidden="true"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          star
        </span>
        <span className="sr-only">Rated </span>
        {activity.allTrailsRating.toFixed(1)}
      </span>
    ),
    cost && (
      <span className={cost === 'Free' ? 'font-medium text-[#1b6b3a]' : undefined}>{cost}</span>
    ),
  ].filter(Boolean);
  return (
    <div className="space-y-xs">
      <div className="flex items-start justify-between gap-xs">
        <h2 className="font-display text-[25px] leading-tight font-bold text-primary">
          {activity.name}
        </h2>
        <DogRulesLink activity={activity} />
      </div>
      <p className="text-body-sm text-on-surface-variant">
        {park &&
          (onOpenPark ? (
            <button
              type="button"
              onClick={() => onOpenPark(park)}
              className="-my-3 inline-flex min-h-11 items-center font-medium text-primary hover:underline"
            >
              {park.name}
            </button>
          ) : (
            park.name
          ))}
        {park && ' · '}
        {activity.location.city}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-xs pt-xs text-body-sm text-on-surface">
        {facts.map((fact, i) => (
          // Each after the first carries its dot, so a wrapped line never
          // ends on one.
          <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {i > 0 && DOT}
            {fact}
          </span>
        ))}
      </p>
    </div>
  );
}

const ACTION =
  'inline-flex h-11.5 min-w-0 items-center justify-center gap-xs rounded-full text-body-sm font-semibold whitespace-nowrap';
const ACTION_OUTLINE = `${ACTION} border border-outline-variant bg-surface-container-lowest text-primary hover:bg-surface-container-low`;

function ActionIcon({ name }: { name: string }) {
  return (
    <span
      className="material-symbols-outlined size-4.5 shrink-0 overflow-hidden text-[18px]"
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

/**
 * Directions, Trip and Done in a row. Trip is for a signed-in account (#112);
 * Done is a toggle for the owners and, for anyone else, a badge shown only
 * once it's done (CLAUDE.md's role-gated rules).
 */
export function PhoneActions({
  activity,
  onTrip,
}: {
  activity: Activity;
  /** Add it to a trip; omitted for a signed-out visitor. */
  onTrip?: () => void;
}) {
  const { completed, toggle } = useCompleted(activity);
  const { isOwner } = useOwner();
  const directions = directionsUrl(activity.location.coords, isApplePlatform());
  return (
    <div className="grid auto-cols-[1fr] grid-flow-col grid-cols-[1.3fr] gap-base">
      {directions && (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className={`${ACTION} bg-primary text-on-primary hover:opacity-90`}
        >
          <ActionIcon name="directions" />
          Directions
        </a>
      )}
      {onTrip && (
        <button type="button" onClick={onTrip} className={ACTION_OUTLINE}>
          <ActionIcon name="add" />
          Trip
        </button>
      )}
      {isOwner ? (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={completed}
          className={
            completed
              ? `${ACTION} border border-primary bg-primary-fixed text-primary hover:bg-primary-fixed-dim`
              : ACTION_OUTLINE
          }
        >
          <ActionIcon name="check" />
          Done
        </button>
      ) : (
        completed && (
          <span className={`${ACTION} bg-primary-fixed text-primary`}>
            <ActionIcon name="check" />
            Done
          </span>
        )
      )}
    </div>
  );
}

/**
 * Text cut to three lines, with More to show the rest: cut at a line, never
 * with an ellipsis, and More only when there's more.
 */
export function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p
        ref={ref}
        className={`text-[15px] leading-[1.55] text-on-surface ${open ? '' : 'max-h-[4.65em] overflow-hidden'}`}
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="-my-2 min-h-11 text-[15px] font-semibold text-primary hover:underline"
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

/** Places side by side, a row that scrolls sideways: each its photo and name. */
export function SideRow({
  heading,
  activities,
  onSelect,
}: {
  heading: string;
  activities: readonly Activity[];
  onSelect: (activity: Activity) => void;
}) {
  return (
    <section aria-label={heading} className="space-y-sm">
      <h3 className="text-body-md font-semibold text-on-surface">{heading}</h3>
      <ul className="-mx-md flex snap-x scroll-px-md scrollbar-none gap-sm overflow-x-auto px-md pb-xs">
        {activities.map((a) => (
          <li key={a.id} className="w-35 shrink-0 snap-start">
            <button
              type="button"
              onClick={() => onSelect(a)}
              className="flex w-full flex-col gap-1.5 text-left"
            >
              <span className="block h-23 w-full overflow-hidden rounded-xl bg-surface-variant">
                <CoverImage
                  src={a.coverImage}
                  alt=""
                  category={a.category}
                  sizes="140px"
                  glyphSize={32}
                  className="size-full object-cover"
                />
              </span>
              <span className="text-[13px] leading-snug font-semibold text-on-surface">
                {a.cardName ?? a.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
