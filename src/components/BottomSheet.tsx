import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../lib/useMediaQuery';

/**
 * The three rest positions of the mobile map's draggable list sheet (#96),
 * Apple-Maps / Find-My style:
 *   - `peek` — just the grabber + summary header, so the map fills the screen.
 *   - `half` — sheet covers the lower half; map and list share the screen.
 *   - `full` — sheet covers almost the whole screen for browsing the list.
 */
export type SheetSnap = 'peek' | 'half' | 'full';

// Cycle order when the grabber is tapped (or Enter/Space): peek → half → full →
// back to peek. Dragging snaps to whichever rest position is nearest on release.
const NEXT: Record<SheetSnap, SheetSnap> = {
  peek: 'half',
  half: 'full',
  full: 'peek',
};

// Peek shows the grabber + the summary header only; this fixed height keeps the
// map dominant. half/full are fractions of the viewport so the sheet scales with
// the device. `PEEK_PX` mirrors the `peek` CSS height (7rem) for snap math.
const PEEK_PX = 112;
const SNAP_CSS: Record<SheetSnap, string> = {
  peek: '7rem',
  half: '52dvh',
  full: '90dvh',
};

// Past this many pixels of travel a pointer gesture counts as a drag (snap to
// nearest) rather than a tap (cycle). Keeps a slightly shaky tap from cycling.
const DRAG_THRESHOLD = 6;

function snapTargetsPx(): Record<SheetSnap, number> {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { peek: PEEK_PX, half: Math.round(vh * 0.52), full: Math.round(vh * 0.9) };
}

function nearestSnap(heightPx: number): SheetSnap {
  const targets = snapTargetsPx();
  return (Object.keys(targets) as SheetSnap[]).reduce((best, snap) =>
    Math.abs(targets[snap] - heightPx) < Math.abs(targets[best] - heightPx)
      ? snap
      : best,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type Props = {
  /** Current rest position (controlled). */
  snap: SheetSnap;
  /** Called when the user drags-to-snap or taps the grabber to cycle. */
  onSnapChange: (snap: SheetSnap) => void;
  /**
   * Always-visible header beneath the grabber — shown even at `peek`, so it
   * should stay short (a summary line, a back affordance). The list body
   * ({@link Props.children}) scrolls below it.
   */
  header?: React.ReactNode;
  /** Scrollable body — the list of cards. */
  children: React.ReactNode;
  /** Accessible name for the sheet region. */
  label: string;
};

/**
 * A frosted, draggable bottom sheet with peek/half/full snap points. Pin it over
 * a full-screen map on phones so the list "rides" above the map (#96). It is
 * `position: fixed` to the viewport bottom (independent of the taller, wrapping
 * mobile header), and fully controlled — the parent owns the `snap` state.
 *
 * Drag the grabber to resize (snaps to the nearest rest position on release);
 * tap it (or press Enter/Space) to cycle peek → half → full; Arrow keys nudge
 * one step. Touch panning on the grabber resizes the sheet rather than scrolling
 * the page (`touch-none`).
 */
export function BottomSheet({
  snap,
  onSnapChange,
  header,
  children,
  label,
}: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startY: number; startH: number; moved: boolean } | null>(
    null,
  );
  // Set when a drag (not a tap) ends, so the synthetic click that follows
  // pointerup on the grabber doesn't also fire the tap-to-cycle.
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Live pixel height while dragging; `null` falls back to the snap's CSS height.
  const [liveH, setLiveH] = useState<number | null>(null);
  const liveHRef = useRef<number | null>(null);
  // Removes the active gesture's window listeners. Held in a ref so an unmount
  // mid-drag can tear them down (see the cleanup effect below).
  const endGestureRef = useRef<(() => void) | null>(null);

  // Tear down any in-flight gesture if the sheet unmounts mid-drag.
  useEffect(() => () => endGestureRef.current?.(), []);

  function handlePointerDown(event: React.PointerEvent) {
    if (typeof window === 'undefined') return;
    // Ignore extra fingers: a second pointerdown mid-drag would bind a duplicate
    // window listener set (double-firing onSnapChange) and orphan the first.
    if (dragRef.current) return;
    // Capture the pointer so the drag keeps tracking as the finger leaves the
    // grabber and the browser doesn't reinterpret the touch as a scroll.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture unavailable (e.g. jsdom); the window listeners below
      // still drive the gesture.
    }
    // Reset up front: a prior *drag* may have set this without a trailing click
    // to clear it (touch drags ending off the grabber don't synthesize one), and
    // a stale `true` would otherwise swallow this gesture's tap.
    suppressClickRef.current = false;
    const startH = sheetRef.current?.offsetHeight ?? snapTargetsPx()[snap];
    const drag = { startY: event.clientY, startH, moved: false };
    dragRef.current = drag;
    setDragging(true);

    // Attach the move/up listeners synchronously here (not via an effect keyed on
    // `dragging`) so a sub-frame pointerup can't fire before they exist.
    const { peek, full } = snapTargetsPx();
    function onMove(e: PointerEvent) {
      // Dragging up (clientY decreases) grows the sheet.
      const delta = drag.startY - e.clientY;
      if (Math.abs(delta) > DRAG_THRESHOLD) drag.moved = true;
      const next = clamp(drag.startH + delta, peek, full);
      liveHRef.current = next;
      setLiveH(next);
    }
    function onUp() {
      endGesture();
      setDragging(false);
      if (drag.moved && liveHRef.current != null) {
        suppressClickRef.current = true;
        onSnapChange(nearestSnap(liveHRef.current));
      }
      dragRef.current = null;
      liveHRef.current = null;
      setLiveH(null);
    }
    function endGesture() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      endGestureRef.current = null;
    }
    endGestureRef.current = endGesture;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // The header row is also a drag handle (bigger target), but taps on the
  // controls inside it (Hide map / Clear) must still work — so bail out of
  // starting a drag when the gesture begins on an interactive element.
  function handleHeaderPointerDown(event: React.PointerEvent) {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, select, input, textarea, [role="button"]')
    ) {
      return;
    }
    handlePointerDown(event);
  }

  function handleClick() {
    // Swallow the click that terminates a real drag; a true tap cycles.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSnapChange(NEXT[snap]);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (snap !== 'full') onSnapChange(snap === 'peek' ? 'half' : 'full');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (snap !== 'peek') onSnapChange(snap === 'full' ? 'half' : 'peek');
    }
  }

  // z-[60] sits above the sticky app header (z-50): at the `full` snap the sheet
  // overlaps the header, and the grabber must stay on top so it's always
  // draggable back down. The detail dialog (z-[1000]) still opens above it.
  return (
    <section
      ref={sheetRef}
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl border-t border-outline-variant/30 bg-surface/95 shadow-[0_-8px_30px_rgba(16,21,27,0.18)] backdrop-blur-xl"
      style={{
        height: liveH != null ? `${liveH}px` : SNAP_CSS[snap],
        transition:
          dragging || reduceMotion
            ? 'none'
            : 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Full-width, ~48px-tall grab bar (Apple's min touch target) so the whole
          top of the sheet is an easy drag/tap target — the little pill alone was
          far too small to hit, especially on touch. */}
      <button
        type="button"
        aria-label={`Resize list, currently ${snap}. Tap to cycle peek, half, full.`}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="flex min-h-12 w-full shrink-0 cursor-grab touch-none flex-col items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-10 rounded-full bg-on-surface-variant/30" />
      </button>
      {header && (
        <div
          onPointerDown={handleHeaderPointerDown}
          className="shrink-0 cursor-grab touch-none px-gutter pb-sm active:cursor-grabbing"
        >
          {header}
        </div>
      )}
      {/* pt-2 keeps the first row's card image outline from being clipped by
          this scroll container's top edge. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter pt-2 pb-md">
        {children}
      </div>
    </section>
  );
}
