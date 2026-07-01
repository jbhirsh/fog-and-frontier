import { useRef, useState, type ReactNode } from 'react';
import type { Activity } from '../data/types';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import { useUserPhotos } from '../lib/userPhotos';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';

const categoryLabels: Record<
  Activity['category'],
  { label: string; icon: string }
> = {
  hiking: { label: 'HIKING', icon: 'directions_walk' },
  cycling: { label: 'CYCLING', icon: 'pedal_bike' },
  water: { label: 'WATER', icon: 'water' },
  food: { label: 'FOOD', icon: 'restaurant' },
  culture: { label: 'CULTURE', icon: 'museum' },
  scenic: { label: 'SCENIC', icon: 'landscape' },
  climbing: { label: 'CLIMBING', icon: 'terrain' },
  camping: { label: 'CAMPING', icon: 'forest' },
  other: { label: 'OTHER', icon: 'explore' },
};

interface Props {
  activity: Activity;
  onClick?: () => void;
  showUserPhotoCount?: boolean;
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
  showUserPhotoCount,
  selected,
  selectionMode,
  actionSlot,
  onHoverChange,
  highlighted,
}: Props) {
  const cat = categoryLabels[activity.category];
  const miles = distanceMiles(HOME_LOCATION.coords, activity.location.coords);
  const { photos } = useUserPhotos(activity.id);
  const overrides = useOverrides();
  const completed = isEffectivelyCompleted(activity, overrides);
  const cover =
    showUserPhotoCount && photos.length > 0 ? photos[0] : activity.coverImage;
  // Some catalog cover URLs are dead (separate data issue, #36/#68). Fall back
  // to a category glyph on the placeholder surface instead of the browser's
  // broken-image icon. Track the *failed URL* (not a boolean) so a later cover
  // change — e.g. a newly-added user photo under `showUserPhotoCount` — isn't
  // hidden by a stale failure of the previous URL.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showCover = !!cover && failedSrc !== cover;

  const distanceLabel =
    miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;

  // Pointer hover and keyboard focus both light the matching pin (#94); track
  // them separately and emit their OR, so moving the mouse away doesn't drop a
  // still-focused highlight and vice-versa. Handlers live on the root (not the
  // button) so the corner action overlay — a sibling sitting on top of the
  // button — doesn't trigger a spurious mouse-leave and flicker the highlight.
  const activeRef = useRef({ pointer: false, focus: false });
  const emitHover = () =>
    onHoverChange?.(activeRef.current.pointer || activeRef.current.focus);

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
        // at the card width so the title's `line-clamp` can take effect.
        className="group flex h-full w-full flex-col items-stretch text-left focus:outline-none"
      >
        {/* Image-led cover. Selected/focus states live on the image, not a
            card border — there is no card chrome around the whole thing. */}
        <div
          className={`relative aspect-[4/3] overflow-hidden rounded-[18px] bg-surface-variant outline outline-offset-2 outline-primary transition-[outline-width,box-shadow] duration-200 group-hover:outline-2 group-hover:shadow-[0_10px_30px_rgba(0,30,55,0.18)] group-focus-visible:outline-2 group-focus-visible:shadow-[0_10px_30px_rgba(0,30,55,0.18)] motion-reduce:transition-none ${
            selected || highlighted
              ? 'outline-2 shadow-[0_10px_30px_rgba(0,30,55,0.18)]'
              : 'outline-0'
          }`}
        >
          {showCover ? (
            <img
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045] motion-reduce:transform-none motion-reduce:transition-none"
              src={cover}
              loading="lazy"
              onError={() => setFailedSrc(cover)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-variant text-on-surface-variant/40">
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 44 }}
              >
                {cat.icon}
              </span>
            </div>
          )}
          {/* Category tag — frosted pill, navy label, accent icon. */}
          <span className="absolute top-sm left-sm inline-flex h-7 items-center gap-xs rounded-full bg-surface-container-lowest/90 px-sm backdrop-blur-sm font-label-caps text-label-caps text-primary">
            <span
              className="material-symbols-outlined text-secondary"
              aria-hidden="true"
              style={{ fontSize: 15 }}
            >
              {cat.icon}
            </span>
            {cat.label}
          </span>
          {selectionMode && (
            <div
              className={`absolute bottom-sm left-sm flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                selected
                  ? 'bg-primary border-primary text-on-primary'
                  : 'bg-surface-container-lowest/90 border-outline-variant/60 text-on-surface-variant'
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
          {showUserPhotoCount && photos.length > 0 && (
            <div className="absolute bottom-sm right-sm flex items-center gap-xs rounded-full bg-surface-container-lowest/90 px-sm py-xs text-primary backdrop-blur-sm">
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 16 }}
              >
                photo_library
              </span>
              <span className="font-label-caps text-label-caps">
                {photos.length}
              </span>
            </div>
          )}
        </div>
        {/* Body sits on the page background — no card surface. Flex column so
            the meta row pins to the bottom and rows stay equal height. */}
        <div className="flex flex-1 flex-col px-xs pt-sm">
          <div className="flex items-start justify-between gap-sm">
            <h3 className="min-w-0 flex-1 line-clamp-2 text-[14px] font-semibold tracking-[-0.015em] text-on-surface transition-colors group-hover:text-primary-container md:text-[16px]">
              {activity.name}
            </h3>
            {activity.allTrailsRating != null && (
              <span className="flex shrink-0 items-center gap-xs text-body-sm font-semibold text-on-surface">
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
          <p className="mt-xs line-clamp-2 text-[13px] text-on-surface-variant md:text-body-sm">
            {activity.shortDescription}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-sm gap-y-xs pt-sm text-[13px] text-on-surface-variant md:text-body-sm">
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
            {/* Distance is pinned to the right edge of the meta row. */}
            <span className="ml-auto flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 17 }}
              >
                location_on
              </span>
              {distanceLabel}
            </span>
          </div>
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
      {(completed || actionSlot) && (
        <div className="absolute top-sm right-sm z-10 flex flex-col items-end gap-xs">
          {completed && (
            <div className="bg-primary-fixed text-primary px-sm py-xs rounded-full flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 16 }}
              >
                check_circle
              </span>
              <span className="font-label-caps text-label-caps">COMPLETED</span>
            </div>
          )}
          {actionSlot}
        </div>
      )}
    </div>
  );
}
