import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibilityInterval } from './useVisibilityInterval';

// Helper: override document.hidden.
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

describe('useVisibilityInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it('fires the callback every ms while the document is visible', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000, true));

    vi.advanceTimersByTime(3000);
    // Three full intervals should have fired.
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does NOT fire while document.hidden is true', () => {
    setHidden(true);
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000, true));

    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires immediately and resumes on visibilitychange when becoming visible', () => {
    setHidden(true);
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000, true));

    // Still hidden — no calls.
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(0);

    // Document becomes visible.
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    // Immediate call on visibility restore.
    expect(cb).toHaveBeenCalledTimes(1);

    // Interval now running again — two more ticks.
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('fires immediately and resumes on window focus when visible', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000, true));

    // Let one tick pass.
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    // Simulate focus event — should fire immediately.
    window.dispatchEvent(new Event('focus'));
    expect(cb).toHaveBeenCalledTimes(2);

    // Continues ticking after focus.
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does NOT fire at all when enabled is false', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000, false));

    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cleans up timers and listeners on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibilityInterval(cb, 1000, true));

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();

    // No more calls after unmount.
    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(1);

    // visibilitychange / focus after unmount should not trigger anything.
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('stops firing when enabled flips to false', () => {
    const cb = vi.fn();
    let enabled = true;
    const { rerender } = renderHook(() => useVisibilityInterval(cb, 1000, enabled));

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    enabled = false;
    rerender();

    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback ref without restarting the interval', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    let currentCb = cb1;
    const { rerender } = renderHook(() =>
      useVisibilityInterval(currentCb, 1000, true),
    );

    vi.advanceTimersByTime(1000);
    expect(cb1).toHaveBeenCalledTimes(1);

    // Swap callback — should NOT reset the interval timer.
    currentCb = cb2;
    rerender();

    vi.advanceTimersByTime(1000);
    expect(cb2).toHaveBeenCalledTimes(1);
    // cb1 got only the one call from before the swap.
    expect(cb1).toHaveBeenCalledTimes(1);
  });
});
