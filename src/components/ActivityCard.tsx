import { useRef, type ReactNode } from 'react';
import type { Activity } from '../data/types';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
import { subItemsLabel } from '../lib/parks';
import { CoverImage } from './CoverImage';
import { DogIcon } from './DogIcon';

interface Props {
  activity: Activity;
  onClick?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
  /**
   * Optional overlay affordance (e.g. an add-to-trip control) rendered in the
   * top-right corner. It sits as a sibling of the card button — never nested
   * inside it — so it stays a valid interactive control and any popover it
   * opens can overflow the card. The card keeps its badges in a row above it
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
  /**
   * A park with its hikes and stops in the list (#269): the card
   * drawn as a stack, its back edges fanned out to the right of the photo,
   * and their count on the photo, a button that opens them.
   */
  stack?: ParkStack;
}

/** A park card's stack: its hikes and stops, and the button that opens them. */
export interface ParkStack {
  count: number;
  open: boolean;
  onToggle: () => void;
  /** The button's id, which focus comes back to when the section closes. */
  id: string;
  /** The section it opens, while it's open. */
  controls?: string;
  /** Two of its places' photos, for the cards drawn behind it. */
  covers?: readonly string[];
}

export function ActivityCard({
  activity,
  onClick,
  selected,
  selectionMode,
  actionSlot,
  onHoverChange,
  highlighted,
  stack,
}: Props) {
  const distance = useDistanceTo()(activity);
  const overrides = useOverrides();
  const completed = isEffectivelyCompleted(activity, overrides);

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
        // at the card width so the title wraps inside it.
        className="group flex size-full flex-col items-stretch text-left focus:outline-none"
      >
        {/* A park's stack: two back edges fanned out to the right of its
            photo, which gives up their room so the card keeps its width and
            its photo lines up with its neighbour's. */}
        <div className={stack ? 'relative aspect-4/3 pr-4' : 'contents'}>
          {stack &&
            // Back to front: two of the park's own places as the cards
            // behind it, each edged in the page's colour so it reads as a
            // card of its own.
            [
              { cover: stack.covers?.[1], place: 'inset-y-3 right-0 rounded-xl' },
              { cover: stack.covers?.[0], place: 'inset-y-1.5 right-2 rounded-[13px]' },
            ].map(({ cover, place }) => (
              <span
                key={place}
                aria-hidden="true"
                className={`absolute w-12 overflow-hidden bg-outline-variant ring-2 ring-surface ${place}`}
              >
                {cover && (
                  <CoverImage
                    alt=""
                    category={activity.category}
                    src={cover}
                    loading="lazy"
                    sizes="48px"
                    glyphSize={16}
                    className="size-full object-cover"
                  />
                )}
              </span>
            ))}
          {/* Image-led cover. Selected/focus states live on the image, not a
            card border — there is no card chrome around the whole thing. */}
          <div
            className={`relative overflow-hidden rounded-[14px] bg-surface-variant outline outline-offset-2 outline-primary transition-[outline-width,box-shadow] duration-200 group-hover:shadow-[0_10px_30px_rgba(0,30,55,0.18)] group-hover:outline-2 group-focus-visible:shadow-[0_10px_30px_rgba(0,30,55,0.18)] group-focus-visible:outline-2 motion-reduce:transition-none ${
              // A stack's photo fills its box, the same height as a card's.
              stack ? 'h-full ring-2 ring-surface' : 'aspect-4/3'
            } ${
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
              // Two to a row on a phone (#290), more as the screen widens.
              sizes="(min-width: 1024px) 25vw, 50vw"
            />
            {/* The facts ride on the photo (#290): Free at the top left
              (while not selecting, when the check is there), and the time,
              distance and rating along the bottom, over a shade that keeps
              them legible on any photo. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-black/70 to-transparent"
            />
            {activity.costTier === 'free' && !selectionMode && (
              <span className="absolute top-base left-base rounded-full bg-surface-container-lowest/95 px-base text-[11.5px] leading-[22px] font-semibold text-[#1b6b3a]">
                Free
              </span>
            )}
            <span className="absolute inset-x-[9px] bottom-[7px] flex flex-wrap items-center justify-between gap-x-base text-[12px] font-semibold text-white">
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
                className={`absolute top-base left-base flex size-8 items-center justify-center rounded-full border-2 ${
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
        </div>
        {/* Body sits on the page background — no card surface. Flex column so
            the meta row pins to the bottom and rows stay equal height. */}
        <div className="flex flex-1 flex-col px-0.5 pt-base">
          {/* The name whole, wrapping, or its shorter card name (#295);
              never an ellipsis. */}
          <h3 className="text-[15px] leading-snug font-semibold tracking-[-0.015em] text-on-surface transition-colors group-hover:text-primary-container">
            {activity.cardName ?? activity.name}
          </h3>
          {/* Its card line (#295), shown whole; the facts are on the photo. */}
          {activity.cardLine && (
            <p className="mt-0.5 text-[13px] leading-snug text-on-surface-variant">
              {activity.cardLine}
            </p>
          )}
        </div>
      </button>
      {/*
        Top-right overlay. The badges (stack count, dog, done check) and the
        optional action affordance (e.g. add-to-trip) share this corner but
        stack vertically, so they never overlap. Rendered as a sibling of the
        card button — not nested inside it — so the action stays interactive
        and its popover can overflow the card. Free and the selection check
        take the top left.
      */}
      {(completed || actionSlot || activity.dogFriendly || stack) && (
        <div
          className={`absolute top-base z-10 flex flex-col items-end gap-xs ${
            // Inside a stack's photo, clear of its fanned edges.
            stack ? 'right-6' : 'right-base'
          }`}
        >
          {/* One row, so the dog never pushes the check down: the check
              keeps the corner, the dog beside it, both the same 22px circle
              (#290), as tall as Free and the stack's count. */}
          {(completed || activity.dogFriendly || stack) && (
            <div className="flex items-center gap-xs">
              {stack && (
                <button
                  type="button"
                  id={stack.id}
                  onClick={stack.onToggle}
                  aria-expanded={stack.open}
                  aria-controls={stack.controls}
                  aria-label={`${subItemsLabel(stack.count)} in ${activity.name}`}
                  className={`inline-flex h-5.5 items-center gap-0.5 rounded-full px-2 text-[11.5px] font-semibold ${
                    stack.open ? 'bg-primary-fixed text-primary' : 'bg-primary text-on-primary'
                  }`}
                >
                  <span
                    className="material-symbols-outlined inline-flex size-3.5 items-center justify-center overflow-hidden text-[14px]"
                    aria-hidden="true"
                  >
                    stacks
                  </span>
                  {stack.count}
                </button>
              )}
              {/* Dogs welcome; none when they aren't. */}
              {activity.dogFriendly && (
                <span
                  role="img"
                  aria-label="Dogs welcome"
                  className="inline-flex size-5.5 items-center justify-center rounded-full bg-surface-container-lowest/95 text-primary"
                >
                  <DogIcon size={16} />
                </span>
              )}
              {completed && (
                // A check in the dog's circle.
                <div className="inline-flex size-5.5 items-center justify-center rounded-full bg-primary-fixed text-primary">
                  <span
                    className="material-symbols-outlined inline-flex size-3.5 items-center justify-center overflow-hidden text-[14px]"
                    aria-hidden="true"
                  >
                    check
                  </span>
                  <span className="sr-only">Completed</span>
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
