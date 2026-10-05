import { useEffect, useId, useRef, useState } from 'react';
import {
  SNAP_CSS,
  cycleSnap,
  dragHeight,
  isDrag,
  nearestSnap,
  snapHeights,
  stepSnap,
  type SheetSnap,
} from '../lib/bottomSheetSnap';
import { useMediaQuery } from '../lib/useMediaQuery';

// Controls inside the header stay tappable: a gesture that starts on one of
// these never begins a drag.
const CONTROLS = 'button, a, input, select, textarea, [role="button"]';

type Props = {
  /** Current rest position (controlled). */
  snap: SheetSnap;
  /** Called when the user drags to a rest position, taps, or uses the keys. */
  onSnapChange: (snap: SheetSnap) => void;
  /**
   * Always-visible header below the grabber, shown even at `peek`, so keep it
   * short (a summary line and an exit). It is also a drag handle.
   */
  header: React.ReactNode;
  /** Scrollable body: the list of cards. */
  children: React.ReactNode;
  /** Accessible name for the sheet region. */
  label: string;
};

/**
 * A frosted, draggable bottom sheet with peek / half / full rest positions,
 * pinned over the full-screen mobile map so the list rides above it (#96).
 * Fixed to the viewport bottom and fully controlled: the parent owns `snap`.
 *
 * The grabber works without dragging: tap it (or press Enter / Space) to cycle
 * peek → half → full, or use the Up / Down arrow keys to step. Dragging it or
 * the header resizes the sheet live and snaps to the nearest rest position on
 * release. `touch-none` keeps a touch drag from scrolling the page instead.
 * The height animates between rest positions unless the user prefers reduced
 * motion.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  header,
  children,
  label,
}: Props) {
  const hintId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Live pixel height while dragging; `null` at rest (the snap's CSS height).
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  // Removes the in-flight gesture's window listeners; `null` when idle.
  const endGestureRef = useRef<(() => void) | null>(null);
  // Set when a drag ends so the click the browser fires after pointerup on the
  // grabber doesn't also cycle. Reset at the start of every gesture: a touch
  // drag that lifts off the grabber fires no click to consume it.
  const suppressClickRef = useRef(false);

  // An unmount mid-drag must not leave window listeners behind.
  useEffect(() => () => endGestureRef.current?.(), []);

  // `fromGrabber`: only a drag that starts on the grabber ends in a click on
  // it. A header drag's click lands on the header, so suppressing for it
  // would eat the next Enter / Space on the grabber instead.
  function startDrag(event: React.PointerEvent<HTMLElement>, fromGrabber: boolean) {
    // A second finger mid-drag would bind a duplicate listener set.
    if (endGestureRef.current) return;
    try {
      // Keep receiving the drag when the pointer leaves the grabber.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Unsupported (jsdom) or the pointer is already gone; the window
      // listeners below still track the gesture.
    }
    suppressClickRef.current = false;
    const heights = snapHeights(window.innerHeight);
    const startY = event.clientY;
    // The sheet sits at its rest height whenever no drag is in progress.
    const startHeight = heights[snap];
    let height = startHeight;
    let moved = false;

    function onMove(e: PointerEvent) {
      moved ||= isDrag(startY, e.clientY);
      height = dragHeight(startHeight, startY, e.clientY, heights);
      setLiveHeight(height);
    }
    function onUp() {
      endGesture();
      if (moved) {
        suppressClickRef.current = fromGrabber;
        onSnapChange(nearestSnap(height, heights));
      }
    }
    // The browser took the pointer over (e.g. a system gesture): drop the drag
    // and settle back at the current rest position.
    function endGesture() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', endGesture);
      endGestureRef.current = null;
      setLiveHeight(null);
    }

    endGestureRef.current = endGesture;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endGesture);
  }

  function handleHeaderPointerDown(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as Element).closest(CONTROLS)) return;
    startDrag(event, false);
  }

  function handleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSnapChange(cycleSnap(snap));
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const direction =
      event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : null;
    if (direction === null) return;
    event.preventDefault();
    const next = stepSnap(snap, direction);
    if (next !== snap) onSnapChange(next);
  }

  const dragging = liveHeight !== null;

  // z-[60] sits above the sticky app header (z-50): at `full` the sheet
  // overlaps the header and the grabber must stay on top so it can always be
  // dragged back down. The detail dialog (z-[1000]) still opens above it.
  return (
    <section
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-[60] flex flex-col pb-[env(safe-area-inset-bottom)] rounded-t-2xl border-t border-outline-variant/30 bg-surface/95 shadow-[0_-8px_30px_rgba(16,21,27,0.18)] backdrop-blur-xl"
      style={{
        height: dragging ? `${liveHeight}px` : SNAP_CSS[snap],
        transition:
          dragging || reduceMotion
            ? 'none'
            : 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {/* A full-width, 48px-tall grab bar (the minimum touch target): the pill
          alone is far too small to hit. */}
      <button
        type="button"
        aria-label={`Resize list, currently ${snap}`}
        aria-describedby={hintId}
        onPointerDown={(event) => startDrag(event, true)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="flex min-h-12 w-full shrink-0 cursor-grab touch-none flex-col items-center justify-center active:cursor-grabbing"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-10 rounded-full bg-on-surface-variant/30"
        />
      </button>
      <span id={hintId} className="sr-only">
        Press to cycle between peek, half and full height. Up and Down arrows
        step the height.
      </span>
      <div
        onPointerDown={handleHeaderPointerDown}
        className="shrink-0 cursor-grab touch-none px-gutter pb-sm active:cursor-grabbing"
      >
        {header}
      </div>
      {/* pt-2 keeps the first card's outline clear of this scroll container's
          top edge. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter pt-2 pb-md">
        {children}
      </div>
    </section>
  );
}
