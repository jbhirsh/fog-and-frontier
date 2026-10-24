import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  COMMIT_SHARE,
  PEEK_GAP,
  FLICK_PX,
  FLICK_PX_PER_MS,
  RESIST,
  SETTLE_MS,
  SLOP,
  dragOffset,
  lockAxis,
  swipeOutcome,
  useSwipe,
  type SwipeHandlers,
} from './swipe';

const BOTH = { hasPrev: true, hasNext: true };
const NEITHER = { hasPrev: false, hasNext: false };
const SIZE = { width: 400, height: 800 };

describe('lockAxis', () => {
  it('waits until the finger has moved past the slop', () => {
    expect(lockAxis(SLOP - 1, 0, { atTop: true, ...BOTH })).toBeNull();
    expect(lockAxis(0, -(SLOP - 1), { atTop: true, ...BOTH })).toBeNull();
    expect(lockAxis(SLOP, 0, { atTop: true, ...BOTH })).toBe('step');
    expect(lockAxis(0, SLOP, { atTop: true, ...BOTH })).toBe('close');
  });

  it('steps on a mostly sideways move, only with somewhere to step to', () => {
    expect(lockAxis(-30, 20, { atTop: true, ...BOTH })).toBe('step');
    expect(lockAxis(30, 0, { atTop: false, hasPrev: true, hasNext: false })).toBe('step');
    expect(lockAxis(-30, 0, { atTop: false, hasPrev: false, hasNext: true })).toBe('step');
    expect(lockAxis(30, 0, { atTop: true, ...NEITHER })).toBe('none');
  });

  it('closes on a pull down from the top, and leaves anything else to the scroll', () => {
    expect(lockAxis(5, 30, { atTop: true, ...NEITHER })).toBe('close');
    expect(lockAxis(5, 30, { atTop: false, ...BOTH })).toBe('none');
    expect(lockAxis(5, -30, { atTop: true, ...BOTH })).toBe('none');
    // Exactly diagonal reads as vertical.
    expect(lockAxis(30, 30, { atTop: true, ...BOTH })).toBe('close');
  });
});

describe('dragOffset', () => {
  it('follows a close down but never up', () => {
    expect(dragOffset('close', 12, 50, BOTH)).toEqual({ x: 0, y: 50 });
    expect(dragOffset('close', 12, -50, BOTH)).toEqual({ x: 0, y: 0 });
  });

  it('follows a step sideways, and resists past an end of the list', () => {
    expect(dragOffset('step', -90, 7, BOTH)).toEqual({ x: -90, y: 0 });
    expect(dragOffset('step', 90, 7, BOTH)).toEqual({ x: 90, y: 0 });
    // A third of the way.
    expect(RESIST).toBeCloseTo(1 / 3);
    expect(dragOffset('step', -90, 0, { hasPrev: true, hasNext: false }).x).toBeCloseTo(-30);
    expect(dragOffset('step', 90, 0, { hasPrev: false, hasNext: true }).x).toBeCloseTo(30);
  });

  it("doesn't move for a scroll", () => {
    expect(dragOffset('none', 40, 40, BOTH)).toEqual({ x: 0, y: 0 });
  });
});

describe('swipeOutcome', () => {
  const far = SIZE.width * COMMIT_SHARE;
  const tall = SIZE.height * COMMIT_SHARE;

  it('steps left to next and right to previous past a quarter of the width', () => {
    expect(swipeOutcome('step', -far, 0, 1000, SIZE, BOTH)).toBe('next');
    expect(swipeOutcome('step', far, 0, 1000, SIZE, BOTH)).toBe('prev');
    expect(swipeOutcome('step', -(far - 1), 0, 1000, SIZE, BOTH)).toBeNull();
  });

  it("doesn't step past an end of the list", () => {
    expect(swipeOutcome('step', -far, 0, 100, SIZE, { hasPrev: true, hasNext: false })).toBeNull();
    expect(swipeOutcome('step', far, 0, 100, SIZE, { hasPrev: false, hasNext: true })).toBeNull();
  });

  it('closes past a quarter of the height', () => {
    expect(swipeOutcome('close', 0, tall, 1000, SIZE, NEITHER)).toBe('close');
    expect(swipeOutcome('close', 0, tall - 1, 1000, SIZE, NEITHER)).toBeNull();
    expect(swipeOutcome('close', 0, -tall, 1000, SIZE, NEITHER)).toBeNull();
  });

  it('takes a short flick if it is fast enough', () => {
    const ms = FLICK_PX / FLICK_PX_PER_MS;
    expect(swipeOutcome('step', -FLICK_PX, 0, ms, SIZE, BOTH)).toBe('next');
    expect(swipeOutcome('step', -FLICK_PX, 0, ms + 1, SIZE, BOTH)).toBeNull();
    expect(swipeOutcome('step', -(FLICK_PX - 1), 0, 1, SIZE, BOTH)).toBeNull();
    expect(swipeOutcome('close', 0, FLICK_PX, ms, SIZE, NEITHER)).toBe('close');
    expect(swipeOutcome('close', 0, FLICK_PX, ms + 1, SIZE, NEITHER)).toBeNull();
    // A release in the same instant counts as one millisecond, not a divide by zero.
    expect(swipeOutcome('step', -FLICK_PX, 0, 0, SIZE, BOTH)).toBe('next');
  });

  it('does nothing for a gesture that never picked an axis, or a scroll', () => {
    expect(swipeOutcome(null, -300, 0, 10, SIZE, BOTH)).toBeNull();
    expect(swipeOutcome('none', 0, 500, 10, SIZE, BOTH)).toBeNull();
  });
});

function Harness({
  noPanel = false,
  noScrim = false,
  withTrack = false,
  ...props
}: SwipeHandlers & { noPanel?: boolean; noScrim?: boolean; withTrack?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useSwipe(panel, scrim, props, withTrack ? track : undefined);
  return (
    <>
      <div data-testid="scrim" ref={noScrim ? undefined : scrim} />
      <div data-testid="track" ref={track}>
        <div data-testid="panel" ref={noPanel ? undefined : panel}>
          <input aria-label="Note" />
          <div className="leaflet-container" data-testid="map" />
          <p>Body</p>
        </div>
      </div>
    </>
  );
}

const panel = () => screen.getByTestId('panel');
const scrim = () => screen.getByTestId('scrim');

function touch(
  target: Element,
  type: 'start' | 'move' | 'end' | 'cancel',
  points: [number, number][],
) {
  const touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
  const init = { touches, changedTouches: touches };
  if (type === 'start') return fireEvent.touchStart(target, init);
  if (type === 'move') return fireEvent.touchMove(target, init);
  if (type === 'end') return fireEvent.touchEnd(target, { touches: [], changedTouches: touches });
  return fireEvent.touchCancel(target, { touches: [], changedTouches: touches });
}

/**
 * A one-finger drag from (100, 100) by (dx, dy), in a few moves, released a
 * second later unless `release` is 'fast' (a flick) or false (still down).
 */
function drag(
  dx: number,
  dy: number,
  target: Element = panel(),
  release: 'slow' | 'fast' | false = 'slow',
) {
  touch(target, 'start', [[100, 100]]);
  for (const f of [0.25, 0.5, 1]) touch(target, 'move', [[100 + dx * f, 100 + dy * f]]);
  if (!release) return;
  if (release === 'slow') vi.advanceTimersByTime(1000);
  touch(target, 'end', [[100 + dx, 100 + dy]]);
}

const LEAVE = `transform ${SETTLE_MS}ms ease-out`;

describe('useSwipe', () => {
  let handlers: SwipeHandlers;

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {
      onClose: vi.fn(),
      onPrev: vi.fn(),
      onNext: vi.fn(),
      enabled: true,
      reduceMotion: false,
    };
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(SIZE.width);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(SIZE.height);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('follows the finger sideways, then leaves and steps to the next one', () => {
    render(<Harness {...handlers} />);
    drag(-200, 10, panel(), false);
    expect(panel().style.transform).toBe('translate(-200px, 0px)');
    expect(panel().style.transition).toBe('none');
    vi.advanceTimersByTime(1000);
    touch(panel(), 'end', [[-100, 110]]);
    expect(panel().style.transform).toBe(`translate(-${window.innerWidth}px, 0px)`);
    expect(panel().style.transition).toBe(LEAVE);
    expect(handlers.onNext).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrev).not.toHaveBeenCalled();
  });

  it('steps to the previous one on a swipe right', () => {
    render(<Harness {...handlers} />);
    drag(200, 0);
    // Off by the window's width, or the panel's if wider.
    expect(window.innerWidth).toBeGreaterThan(SIZE.width);
    expect(panel().style.transform).toBe(`translate(${window.innerWidth}px, 0px)`);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onPrev).toHaveBeenCalledTimes(1);
  });

  it('pulls down from the top to close, dimming the scrim as it goes', () => {
    render(<Harness {...handlers} />);
    drag(0, 400, panel(), false);
    expect(panel().style.transform).toBe('translate(0px, 400px)');
    expect(scrim().style.opacity).toBe('0.5');
    expect(scrim().style.transition).toBe('none');
    vi.advanceTimersByTime(1000);
    touch(panel(), 'end', [[100, 500]]);
    // Off by the panel's height, or the window's if taller.
    expect(window.innerHeight).toBeLessThan(SIZE.height);
    expect(panel().style.transform).toBe(`translate(0px, ${SIZE.height}px)`);
    expect(panel().style.transition).toBe(LEAVE);
    expect(scrim().style.opacity).toBe('0');
    expect(scrim().style.transition).toBe(`opacity ${SETTLE_MS}ms ease-out`);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('picks an axis within a few pixels, before a browser would start scrolling', () => {
    expect(SLOP).toBe(4);
  });

  it('leaves a move the browser has already claimed to it', () => {
    render(<Harness {...handlers} />);
    touch(panel(), 'start', [[100, 100]]);
    fireEvent(
      panel(),
      new TouchEvent('touchmove', {
        bubbles: true,
        cancelable: false,
        touches: [{ clientX: 100, clientY: 300 } as Touch],
      }),
    );
    touch(panel(), 'move', [[100, 500]]);
    touch(panel(), 'end', [[100, 500]]);
    expect(panel().style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('takes over from an entrance animation still running', () => {
    render(<Harness {...handlers} />);
    drag(-60, 0, panel(), false);
    expect(panel().style.animation).toBe('none');
  });

  it('acts at once when motion is reduced', () => {
    render(<Harness {...handlers} reduceMotion />);
    drag(0, 400);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('settles back from a swipe too short to count', () => {
    render(<Harness {...handlers} />);
    drag(0, 60);
    expect(panel().style.transform).toBe('');
    expect(panel().style.transition).toBe(LEAVE);
    expect(scrim().style.opacity).toBe('');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('leaves a pull down to the scroll when the panel is scrolled', () => {
    render(<Harness {...handlers} />);
    panel().scrollTop = 120;
    drag(0, 400);
    // Never touched: the browser scrolled.
    expect(panel().style.transform).toBe('');
    expect(panel().style.transition).toBe('');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('claims the move from the browser only once it is a swipe', () => {
    render(<Harness {...handlers} />);
    touch(panel(), 'start', [[100, 100]]);
    // Within the slop: still the browser's.
    expect(touch(panel(), 'move', [[102, 103]])).toBe(true);
    // A swipe: the scroll is stopped.
    expect(touch(panel(), 'move', [[60, 103]])).toBe(false);
    // Released slowly, short of a quarter: it settles back.
    vi.advanceTimersByTime(1000);
    touch(panel(), 'end', [[60, 103]]);
    // A scroll up stays the browser's all the way.
    touch(panel(), 'start', [[100, 300]]);
    expect(touch(panel(), 'move', [[100, 200]])).toBe(true);
    expect(touch(panel(), 'move', [[40, 100]])).toBe(true);
    touch(panel(), 'end', [[40, 100]]);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it('resists past the end of the list, and stays put', () => {
    render(<Harness {...handlers} onNext={undefined} />);
    drag(-300, 0, panel(), false);
    expect(panel().style.transform).toBe(`translate(${-300 * RESIST}px, 0px)`);
    touch(panel(), 'end', [[-200, 100]]);
    expect(panel().style.transform).toBe('');
  });

  it("doesn't swipe sideways with nowhere to step", () => {
    render(<Harness {...handlers} onPrev={undefined} onNext={undefined} />);
    drag(-300, 0);
    expect(panel().style.transform).toBe('');
  });

  it('leaves fields and maps alone', () => {
    render(<Harness {...handlers} />);
    drag(-300, 0, screen.getByRole('textbox', { name: 'Note' }));
    drag(0, 400, screen.getByTestId('map'));
    expect(panel().style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    render(<Harness {...handlers} enabled={false} />);
    drag(0, 400);
    touch(panel(), 'cancel', []);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(panel().style.transform).toBe('');
    expect(panel().style.transition).toBe('');
  });

  it('calls a swipe off when a second finger lands, or the browser cancels it', () => {
    render(<Harness {...handlers} />);
    drag(-200, 0, panel(), false);
    touch(panel(), 'start', [
      [-100, 100],
      [200, 300],
    ]);
    expect(panel().style.transform).toBe('');
    expect(panel().style.transition).toBe(LEAVE);
    touch(panel(), 'end', [[-100, 100]]);
    drag(0, 300, panel(), false);
    touch(panel(), 'cancel', [[100, 400]]);
    expect(panel().style.transform).toBe('');
    expect(scrim().style.opacity).toBe('');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('ignores touches while it is leaving, and stops when unmounted', () => {
    const { unmount } = render(<Harness {...handlers} />);
    drag(-200, 0);
    // Mid-leave: a new swipe is ignored.
    drag(200, 0);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrev).not.toHaveBeenCalled();
    drag(-200, 0);
    unmount();
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it('takes a short flick, but not the same distance slowly', () => {
    render(<Harness {...handlers} />);
    drag(-(FLICK_PX + 5), 0);
    expect(panel().style.transform).toBe('');
    drag(-(FLICK_PX + 5), 0, panel(), 'fast');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it('leaves the panel alone for a tap, a stray end or a cancel with nothing moved', () => {
    render(<Harness {...handlers} />);
    touch(panel(), 'end', [[100, 100]]);
    touch(panel(), 'start', [[100, 100]]);
    touch(panel(), 'move', [[103, 102]]);
    touch(panel(), 'end', [[103, 102]]);
    touch(panel(), 'start', [[100, 100]]);
    touch(panel(), 'cancel', [[100, 100]]);
    expect(panel().style.transition).toBe('');
    expect(panel().style.transform).toBe('');
  });

  it('listens passively to the start and actively to the move', () => {
    const listen = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    render(<Harness {...handlers} />);
    const options = Object.fromEntries(
      listen.mock.calls
        .filter(([type]) => String(type).startsWith('touch'))
        .map(([type, , opts]) => [type, opts]),
    );
    expect(options).toEqual({
      touchstart: { passive: true },
      touchmove: { passive: false },
      touchend: undefined,
      touchcancel: undefined,
    });
  });

  it('stops listening when unmounted mid-swipe', () => {
    const { unmount } = render(<Harness {...handlers} />);
    const el = panel();
    drag(-200, 0, el, false);
    unmount();
    vi.advanceTimersByTime(1000);
    touch(el, 'move', [[-200, 100]]);
    expect(el.style.transform).toBe('translate(-200px, 0px)');
    touch(el, 'cancel', [[-200, 100]]);
    expect(el.style.transition).toBe('none');
    touch(el, 'end', [[-200, 100]]);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(el.style.transform).toBe('translate(-200px, 0px)');
  });

  it('does without a scrim, and does nothing without a panel', () => {
    const { unmount } = render(<Harness {...handlers} noScrim />);
    drag(0, 400);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    unmount();
    render(<Harness {...handlers} noPanel />);
    drag(0, 400);
    expect(panel().style.transform).toBe('');
  });

  describe('with a track carrying the neighbours', () => {
    const track = () => screen.getByTestId('track');

    it('moves the track, not the panel, and marks it while it is off centre', () => {
      render(<Harness {...handlers} withTrack />);
      expect(track().dataset.swiping).toBeUndefined();
      drag(-60, 0, panel(), false);
      expect(track().style.transform).toBe('translate(-60px, 0px)');
      expect(panel().style.transform).toBe('');
      expect(track().dataset.swiping).toBe('true');
      // Released short of a step: it settles back, and the mark goes once it has.
      vi.advanceTimersByTime(1000);
      touch(panel(), 'end', [[40, 100]]);
      expect(track().style.transform).toBe('');
      expect(track().style.transition).toBe(LEAVE);
      expect(track().dataset.swiping).toBe('true');
      vi.advanceTimersByTime(SETTLE_MS - 1);
      expect(track().dataset.swiping).toBe('true');
      vi.advanceTimersByTime(1);
      expect(track().dataset.swiping).toBeUndefined();
    });

    it('steps by exactly the panel and the gap, leaving the neighbour where the panel was', () => {
      render(<Harness {...handlers} withTrack />);
      drag(-200, 0);
      expect(track().style.transform).toBe(`translate(${-(SIZE.width + PEEK_GAP)}px, 0px)`);
      expect(track().dataset.swiping).toBe('true');
      act(() => {
        vi.advanceTimersByTime(SETTLE_MS);
      });
      expect(handlers.onNext).toHaveBeenCalledTimes(1);
      drag(200, 0);
      expect(track().style.transform).toBe(`translate(${SIZE.width + PEEK_GAP}px, 0px)`);
    });

    it('keeps the mark through a new swipe started while settling', () => {
      render(<Harness {...handlers} withTrack />);
      drag(-60, 0);
      drag(-60, 0, panel(), false);
      vi.advanceTimersByTime(SETTLE_MS);
      expect(track().dataset.swiping).toBe('true');
    });

    it('unmarks at once for a pull down started while settling back', () => {
      render(<Harness {...handlers} withTrack />);
      drag(-60, 0);
      expect(track().dataset.swiping).toBe('true');
      drag(0, 100, panel(), false);
      expect(track().dataset.swiping).toBeUndefined();
      vi.advanceTimersByTime(SETTLE_MS);
      expect(track().dataset.swiping).toBeUndefined();
    });

    it('closes by moving the track down, unmarked', () => {
      render(<Harness {...handlers} withTrack />);
      drag(0, 400, panel(), false);
      expect(track().style.transform).toBe('translate(0px, 400px)');
      expect(track().dataset.swiping).toBeUndefined();
      // An entrance on the panel itself still gives way to the finger.
      expect(panel().style.animation).toBe('none');
    });

    it('stops its settle timer when unmounted', () => {
      const { unmount } = render(<Harness {...handlers} withTrack />);
      const el = track();
      drag(-60, 0);
      unmount();
      vi.advanceTimersByTime(SETTLE_MS);
      expect(el.dataset.swiping).toBe('true');
    });
  });

  it('uses the handlers of the latest render', () => {
    const { rerender } = render(<Harness {...handlers} />);
    const onNext = vi.fn();
    rerender(<Harness {...handlers} onNext={onNext} />);
    drag(-200, 0);
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).not.toHaveBeenCalled();
  });
});
