import { useEffect, useRef, type RefObject } from 'react';

// Touch gestures on an open activity: swipe down to close it, swipe left or
// right to step to the next or previous one in the list it was opened from
// (#64). The rules are plain functions so they can be tested exactly; the
// hook below only feeds them touches and moves the panel.

/**
 * How far a finger travels before the gesture picks an axis, in px. Under
 * the distance at which a browser starts scrolling (about 8px on Chrome for
 * Android, 10pt on iOS), so a swipe is claimed before a scroll or bounce can
 * begin.
 */
export const SLOP = 4;
/** Share of the panel's width or height that commits a swipe on release. */
export const COMMIT_SHARE = 0.25;
/** A shorter swipe still commits if it's a flick: this far, this fast. */
export const FLICK_PX = 40;
export const FLICK_PX_PER_MS = 0.5;
/** A drag past the end of the list moves this much of the finger's distance. */
export const RESIST = 1 / 3;
/** How long the panel takes to leave, or to settle back, in ms. */
export const SETTLE_MS = 200;
/**
 * The space between the panel and the neighbours that ride beside it on a
 * track while it's swiped sideways, in px.
 */
export const PEEK_GAP = 16;

/** What a gesture is doing once it has picked an axis. */
export type SwipeAxis = 'step' | 'close' | 'none';
export type SwipeOutcome = 'close' | 'prev' | 'next';

export interface SwipeContext {
  /** The detail is scrolled to the top, so a pull down can close it. */
  atTop: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * The axis a gesture takes once it has moved past the slop, or null while it
 * hasn't. Sideways steps only with somewhere to step to; down closes only from
 * the top. Anything else ('none') is left to the browser: a scroll.
 */
export function lockAxis(dx: number, dy: number, ctx: SwipeContext): SwipeAxis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SLOP) return null;
  if (ax > ay) return ctx.hasPrev || ctx.hasNext ? 'step' : 'none';
  return dy > 0 && ctx.atTop ? 'close' : 'none';
}

/**
 * Where the panel sits under the finger. A close follows it down but never
 * up; a step follows it sideways, and drags past an end of the list with
 * resistance.
 */
export function dragOffset(
  axis: SwipeAxis,
  dx: number,
  dy: number,
  ctx: Pick<SwipeContext, 'hasPrev' | 'hasNext'>,
): { x: number; y: number } {
  if (axis === 'close') return { x: 0, y: Math.max(0, dy) };
  if (axis !== 'step') return { x: 0, y: 0 };
  const open = dx < 0 ? ctx.hasNext : ctx.hasPrev;
  return { x: open ? dx : dx * RESIST, y: 0 };
}

/** Far enough, or fast enough, to count. */
function commits(distance: number, ms: number, size: number): boolean {
  if (distance >= size * COMMIT_SHARE) return true;
  return distance >= FLICK_PX && distance / Math.max(ms, 1) >= FLICK_PX_PER_MS;
}

/**
 * What a released gesture does: close, step, or nothing (the panel settles
 * back). Left is next and right is previous, as a page turns.
 */
export function swipeOutcome(
  axis: SwipeAxis | null,
  dx: number,
  dy: number,
  ms: number,
  size: { width: number; height: number },
  ctx: Pick<SwipeContext, 'hasPrev' | 'hasNext'>,
): SwipeOutcome | null {
  if (axis === 'close') return commits(dy, ms, size.height) ? 'close' : null;
  if (axis !== 'step' || !commits(Math.abs(dx), ms, size.width)) return null;
  if (dx < 0) return ctx.hasNext ? 'next' : null;
  return ctx.hasPrev ? 'prev' : null;
}

/** Where a gesture can't start: fields, and anything that pans on its own. */
const OWNS_TOUCH = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '.leaflet-container',
  '[data-no-swipe]',
].join(', ');

export interface SwipeHandlers {
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Off while something else owns the panel (the edit form). */
  enabled: boolean;
  /** Skip the leave animation (prefers-reduced-motion). */
  reduceMotion: boolean;
}

/**
 * Wires the gestures to a scrolling panel and the scrim behind it. Touch
 * events rather than pointer events: the panel scrolls, and only a non-passive
 * touchmove can stop that scroll once the gesture turns out to be a swipe.
 * The panel moves through its inline transform, so a drag doesn't re-render.
 *
 * With a `track` (the panel's parent, carrying previews of its neighbours
 * PEEK_GAP to either side), the track moves instead: a sideways swipe brings
 * the neighbour in beside the panel, and a step leaves it where the panel
 * was, for the next activity to take over in place. The track is marked
 * `data-swiping` while it's off centre, so the previews can show only then.
 */
export function useSwipe(
  panel: RefObject<HTMLElement | null>,
  scrim: RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
  track?: RefObject<HTMLElement | null>,
): void {
  // The latest handlers, read at each touch so the listeners bind once.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // The gesture in progress; `moved` once it has taken the panel over.
    let gesture: {
      x: number;
      y: number;
      t: number;
      axis: SwipeAxis | null;
      dx: number;
      dy: number;
      moved: boolean;
    } | null = null;
    let leaving: ReturnType<typeof setTimeout> | undefined;
    // Hides the previews once the track has settled back.
    let settled: ReturnType<typeof setTimeout> | undefined;

    const context = (): SwipeContext => ({
      atTop: el.scrollTop <= 0,
      hasPrev: !!latest.current.onPrev,
      hasNext: !!latest.current.onNext,
    });

    function place(x: number, y: number, animate: boolean) {
      // An entrance still running (the open, or a step's slide) would hold
      // the panel where it is: the finger wins.
      el!.style.animation = 'none';
      const mover = track?.current ?? el!;
      mover.style.transition = animate ? `transform ${SETTLE_MS}ms ease-out` : 'none';
      mover.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
      clearTimeout(settled);
      if (x) mover.dataset.swiping = 'true';
      else if (animate) settled = setTimeout(() => delete mover.dataset.swiping, SETTLE_MS);
      else delete mover.dataset.swiping;
      const shade = scrim.current;
      if (shade) {
        shade.style.transition = animate ? `opacity ${SETTLE_MS}ms ease-out` : 'none';
        shade.style.opacity = y ? String(Math.max(0, 1 - y / el!.offsetHeight)) : '';
      }
    }

    // Drops the gesture; a panel it had moved settles back.
    function cancel() {
      const moved = gesture?.moved;
      gesture = null;
      if (moved) place(0, 0, true);
    }

    function onStart(e: TouchEvent) {
      // Mid-leave, the panel is already on its way out.
      if (leaving) return;
      // A second finger (a pinch) calls the gesture off.
      if (e.touches.length !== 1 || !latest.current.enabled) {
        cancel();
        return;
      }
      // A touch lands on an element, never on text.
      if ((e.target as Element).closest(OWNS_TOUCH)) return;
      const touch = e.touches[0];
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        t: e.timeStamp,
        axis: null,
        dx: 0,
        dy: 0,
        moved: false,
      };
    }

    function onMove(e: TouchEvent) {
      if (!gesture) return;
      const touch = e.touches[0];
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
      // A move the browser won't let go of is already its scroll.
      gesture.axis ??= e.cancelable ? lockAxis(gesture.dx, gesture.dy, context()) : 'none';
      if (gesture.axis === null || gesture.axis === 'none') return;
      // Ours now: no scroll, no overscroll bounce, no click at the end.
      e.preventDefault();
      gesture.moved = true;
      const { x, y } = dragOffset(gesture.axis, gesture.dx, gesture.dy, context());
      place(x, y, false);
    }

    function onEnd(e: TouchEvent) {
      const done = gesture;
      gesture = null;
      // A tap, or a scroll: nothing of ours to finish.
      if (!done?.moved) return;
      const { onClose, onPrev, onNext, reduceMotion } = latest.current;
      const outcome = swipeOutcome(
        done.axis,
        done.dx,
        done.dy,
        e.timeStamp - done.t,
        { width: el!.offsetWidth, height: el!.offsetHeight },
        context(),
      );
      const act =
        outcome === 'close'
          ? onClose
          : outcome === 'next'
            ? onNext
            : outcome === 'prev'
              ? onPrev
              : undefined;
      if (!act) {
        place(0, 0, true);
        return;
      }
      if (reduceMotion) {
        act();
        return;
      }
      // Away the way it was going (a step lands on the neighbour riding
      // beside it, or else goes off the screen), then act; the detail that
      // replaces it (or the page below) takes over from there.
      const across = track?.current
        ? el!.offsetWidth + PEEK_GAP
        : Math.max(el!.offsetWidth, window.innerWidth);
      if (outcome === 'close') place(0, Math.max(el!.offsetHeight, window.innerHeight), true);
      else place(outcome === 'next' ? -across : across, 0, true);
      leaving = setTimeout(() => {
        leaving = undefined;
        act();
      }, SETTLE_MS);
    }

    // A passive touchstart keeps scrolling prompt; touchmove must not be
    // passive, or it couldn't stop the scroll once a swipe is ours.
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', cancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', cancel);
      clearTimeout(leaving);
      clearTimeout(settled);
    };
  }, [panel, scrim, track]);
}
