import { useRef, type ReactNode } from 'react';
import type { Activity } from '../data/types';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
import { contributorsLabel } from '../lib/contributors';
import { usePersonLabel } from '../lib/people';
import { CATEGORY_ICON } from '../lib/mapPins';
import { glyphBleed } from '../lib/iconMetrics';
import { CoverImage } from './CoverImage';
import { DogIcon } from './DogIcon';

// Pill label per category. The glyph comes from the shared CATEGORY_ICON, so
// the pill, the cover fallback and the map pin always agree.
const categoryLabels: Record<Activity['category'], string> = {
  hiking: 'HIKING',
  cycling: 'CYCLING',
  water: 'WATER',
  food: 'FOOD',
  culture: 'CULTURE',
  scenic: 'SCENIC',
  climbing: 'CLIMBING',
  camping: 'CAMPING',
  other: 'OTHER',
};

interface Props {
  activity: Activity;
  onClick?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
  /**
   * Optional overlay affordance (e.g. an add-to-trip control) rendered in the
   * top-right corner. It sits as a sibling of the card button — never nested
   * inside it — so it stays a valid interactive control and any popover it
   * opens can overflow the card. The card stacks the COMPLETED badge above it
   * so the two never collide.
   */
  actionSlot?: ReactNode;
  /**
   * Notified when the card gains/loses pointer hover OR keyboard focus (#94).
   * The split view uses this to highlight the matching map pin. Focus parity
   * means tabbing through the list highlights pins too, not just mousing.
   */
  onHoverChange?: (hovering: boolean) => void;
  /**
   * Render the card in its highlighted state (same cover outline + lift as
   * `selected`) when its map pin is hovered (#94) — the reverse of
   * {@link onHoverChange}. Only the cards currently in the list react; a pin
   * whose card is filtered out of the view simply has nothing to outline.
   */
  highlighted?: boolean;
}

export function ActivityCard({
  activity,
  onClick,
  selected,
  selectionMode,
  actionSlot,
  onHoverChange,
  highlighted,
}: Props) {
  const categoryLabel = categoryLabels[activity.category];
  const origin = useDistanceOrigin();
  const distance = useDistanceTo()(activity);
  const overrides = useOverrides();
  const completed = isEffectivelyCompleted(activity, overrides);
  const contributors = contributorsLabel(activity.contributors, usePersonLabel());

  // Road miles "from you" or "from San Jose" (#66), never bare miles; "≈"
  // marks the straight-line estimate shown until road miles load.
  const distanceLabel = `${formatMiles(distance)} mi from ${origin.name}`;

  // Pointer hover and keyboard focus both light the matching pin (#94); track
  // them separately and emit their OR, so moving the mouse away doesn't drop a
  // still-focused highlight and vice-versa. Handlers live on the root (not the
  // button) so the corner action overlay — a sibling sitting on top of the
  // button — doesn't trigger a spurious mouse-leave and flicker the highlight.
  const activeRef = useRef({ pointer: false, focus: false });
  const emitHover = () => onHoverChange?.(activeRef.current.pointer || activeRef.current.focus);

  return (
    // `data-activity-id` lets the list scroll a card into view by id when its
    // map pin is clicked (#94).
    <div
      className="relative h-full"
      data-activity-id={activity.id}
      onMouseEnter={() => {
        activeRef.current.pointer = true;
        emitHover();
      }}
      onMouseLeave={() => {
        activeRef.current.pointer = false;
        emitHover();
      }}
      onFocus={() => {
        activeRef.current.focus = true;
        emitHover();
      }}
      onBlur={(e) => {
        // Ignore focus moving between elements inside the same card (e.g. button
        // → the add-to-trip control); only clear when focus leaves the card.
        if (e.currentTarget.contains(e.relatedTarget)) return;
        activeRef.current.focus = false;
        emitHover();
      }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selectionMode ? !!selected : undefined}
        // `items-stretch` is load-bearing: WebKit/Safari resolves `align-items`
        // to `flex-start` (not `stretch`) on a <button> flex container, so the
        // body column shrinks to its content and a long title overflows the
        // card, overlapping the neighbour. Chromium stretches by default, which
        // is why this only reproduces in Safari. Forcing stretch keeps the body
        // at the card width so the title's `truncate` can take effect.
        className="group flex size-full flex-col items-stretch text-left focus:outline-none"
      >
        {/* Image-led cover. Selected/focus states live on the image, not a
            card border — there is no card chrome around the whole thing. */}
        <div
          className={`relative aspect-4/3 overflow-hidden rounded-[14px] bg-surface-variant outline outline-offset-2 outline-primary transition-[outline-width,box-shadow] duration-200 group-hover:shadow-[0_10px_30px_rgba(0,30,55,0.18)] group-hover:outline-2 group-focus-visible:shadow-[0_10px_30px_rgba(0,30,55,0.18)] group-focus-visible:outline-2 motion-reduce:transition-none md:aspect-3/2 md:rounded-[18px] ${
            selected || highlighted
              ? 'shadow-[0_10px_30px_rgba(0,30,55,0.18)] outline-2'
              : 'outline-0'
          }`}
        >
          <CoverImage
            alt=""
            category={activity.category}
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045] motion-reduce:transform-none motion-reduce:transition-none"
            src={activity.coverImage}
            loading="lazy"
            // Two to a row on a phone (#290), up to three wider.
            sizes="(min-width: 1024px) 33vw, 50vw"
          />
          {/* Category tag — frosted pill, navy label, accent icon. A phone's
              card leaves it out for room (#290). */}
          <span className="absolute top-sm left-sm hidden h-7 items-center gap-xs rounded-full bg-surface-container-lowest/90 px-sm font-label-caps text-label-caps text-primary backdrop-blur-sm md:inline-flex">
            <span
              className="material-symbols-outlined text-secondary"
              aria-hidden="true"
              style={{ fontSize: 15, marginLeft: glyphBleed(CATEGORY_ICON[activity.category]) }}
            >
              {CATEGORY_ICON[activity.category]}
            </span>
            {categoryLabel}
          </span>
          {/* On a phone the facts ride on the photo (#290): Free at the top
              left (while not selecting, when the check is there), and the
              time, distance and rating along the bottom, over a shade that
              keeps them legible on any photo. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-black/70 to-transparent md:hidden"
          />
          {activity.costTier === 'free' && !selectionMode && (
            <span className="absolute top-base left-base rounded-full bg-surface-container-lowest/95 px-base text-[11.5px] leading-[22px] font-semibold text-[#1b6b3a] md:hidden">
              Free
            </span>
          )}
          <span className="absolute inset-x-[9px] bottom-[7px] flex flex-wrap items-center justify-between gap-x-base text-[12px] font-semibold text-white md:hidden">
            <span>
              {activity.duration} · {formatMiles(distance)} mi
            </span>
            {activity.allTrailsRating != null && (
              <span className="inline-flex items-center gap-0.5">
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
                {activity.allTrailsRating.toFixed(1)}
              </span>
            )}
          </span>
          {selectionMode && (
            <div
              className={`absolute top-base left-base flex size-8 items-center justify-center rounded-full border-2 md:top-auto md:bottom-sm md:left-sm ${
                selected
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant/60 bg-surface-container-lowest/90 text-on-surface-variant'
              }`}
              aria-hidden="true"
            >
              {selected && (
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 20 }}
                >
                  check
                </span>
              )}
            </div>
          )}
        </div>
        {/* Body sits on the page background — no card surface. Flex column so
            the meta row pins to the bottom and rows stay equal height. */}
        <div className="flex flex-1 flex-col px-0.5 pt-base md:px-xs md:pt-sm">
          <div className="flex items-center justify-between gap-sm">
            {/* A phone's card shows the name whole, wrapping, or its shorter
                card name (#295); never an ellipsis. */}
            <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold tracking-[-0.015em] text-on-surface transition-colors group-hover:text-primary-container md:truncate md:text-[16px] md:leading-normal">
              {activity.cardName ? (
                <>
                  <span className="md:hidden">{activity.cardName}</span>
                  <span className="hidden md:inline">{activity.name}</span>
                </>
              ) : (
                activity.name
              )}
            </h3>
            {activity.allTrailsRating != null && (
              <span className="hidden shrink-0 items-center gap-xs text-body-sm font-semibold text-on-surface md:flex">
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
                {activity.allTrailsRating.toFixed(1)}
              </span>
            )}
          </div>
          {/* A phone's card has its card line (#295), shown whole, in the
              short description's place, and its facts on the photo. */}
          {activity.cardLine && (
            <p className="mt-0.5 text-[13px] leading-snug text-on-surface-variant md:hidden">
              {activity.cardLine}
            </p>
          )}
          <p className="mt-xs hidden text-body-sm text-on-surface-variant md:block">
            {activity.shortDescription}
          </p>
          <div className="mt-auto hidden flex-wrap items-center gap-sm pt-sm text-body-sm text-on-surface-variant md:flex">
            <span className="flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 17 }}
              >
                schedule
              </span>
              {activity.duration}
            </span>
            <span className="flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 17 }}
              >
                location_on
              </span>
              {distanceLabel}
            </span>
            {activity.dogFriendly && (
              <span className="flex items-center gap-xs">
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 17 }}
                >
                  pets
                </span>
                Dog OK
              </span>
            )}
          </div>
          {/* Signed-in only: the server sends no contributors otherwise (#9). */}
          {contributors && (
            <p className="mt-xs hidden truncate text-body-sm text-on-surface-variant md:block">
              Contributed by {contributors}
            </p>
          )}
        </div>
      </button>
      {/*
        Top-right overlay stack. The COMPLETED badge and the optional action
        affordance (e.g. add-to-trip) share this corner but stack vertically,
        so they never overlap. Rendered as a sibling of the card button — not
        nested inside it — so the action stays interactive and its popover can
        overflow the card. Other badges keep their own corners: category tag
        (top-left), photo-count (bottom-right), selection check (bottom-left).
      */}
      {(completed || actionSlot || activity.dogFriendly) && (
        <div className="absolute top-base right-base z-10 flex flex-col items-end gap-xs md:top-sm md:right-sm">
          {/* One row, so the dog never pushes the check down: the check
              keeps the corner, the dog beside it, both the same 30px circle
              on a phone (#290). */}
          {(completed || activity.dogFriendly) && (
            <div className="flex items-center gap-xs">
              {/* Dogs welcome, on a phone's card only; none when they aren't. */}
              {activity.dogFriendly && (
                <span
                  role="img"
                  aria-label="Dogs welcome"
                  className="inline-flex size-7.5 items-center justify-center rounded-full bg-surface-container-lowest/95 text-primary md:hidden"
                >
                  <DogIcon size={20} />
                </span>
              )}
              {completed && (
                // On a phone, a check in the dog's circle. From md, the
                // category tag's twin: the same 28px pill and 15px icon, so
                // the two sit level across the top of the photo.
                <div className="inline-flex size-7.5 items-center justify-center rounded-full bg-primary-fixed text-primary md:size-auto md:h-7 md:gap-xs md:px-sm">
                  <span
                    className="material-symbols-outlined inline-flex size-5 items-center justify-center overflow-hidden text-[20px] md:hidden"
                    aria-hidden="true"
                  >
                    check
                  </span>
                  <span
                    className="material-symbols-outlined hidden md:inline"
                    aria-hidden="true"
                    style={{ fontSize: 15, marginLeft: glyphBleed('check_circle') }}
                  >
                    check_circle
                  </span>
                  <span className="hidden font-label-caps text-label-caps md:inline">
                    COMPLETED
                  </span>
                  <span className="sr-only md:hidden">Completed</span>
                </div>
              )}
            </div>
          )}
          {actionSlot}
        </div>
      )}
    </div>
  );
}
