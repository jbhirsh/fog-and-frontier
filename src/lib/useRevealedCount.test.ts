import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRevealedCount, useWhenVisible } from './useRevealedCount';

describe('useRevealedCount', () => {
  it('starts with one page, or the whole list when it is shorter', () => {
    expect(renderHook(() => useRevealedCount(20, 6)).result.current).toMatchObject({
      count: 6,
      remaining: 14,
    });
    expect(renderHook(() => useRevealedCount(4, 6)).result.current).toMatchObject({
      count: 4,
      remaining: 0,
    });
  });

  it('adds a page at a time, stopping at the end', () => {
    const { result } = renderHook(() => useRevealedCount(14, 6));
    act(() => result.current.showMore());
    expect(result.current).toMatchObject({ count: 12, remaining: 2 });
    act(() => result.current.showMore());
    expect(result.current).toMatchObject({ count: 14, remaining: 0 });
  });

  it('grows to whole pages that include a given item', () => {
    const { result } = renderHook(() => useRevealedCount(30, 6));
    act(() => result.current.revealTo(6));
    expect(result.current.count).toBe(12);
    act(() => result.current.revealTo(17));
    expect(result.current.count).toBe(18);
    act(() => result.current.revealTo(18));
    expect(result.current.count).toBe(24);
  });

  it('never shrinks to reveal an item already shown', () => {
    const { result } = renderHook(() => useRevealedCount(30, 6));
    act(() => result.current.showMore());
    act(() => result.current.showMore());
    act(() => result.current.revealTo(2));
    expect(result.current.count).toBe(18);
  });

  it('fills a larger page at once and pages by it (Split to List)', () => {
    const { result, rerender } = renderHook(({ size }) => useRevealedCount(40, size), {
      initialProps: { size: 6 },
    });
    rerender({ size: 12 });
    expect(result.current).toMatchObject({ count: 12, remaining: 28 });
    act(() => result.current.showMore());
    expect(result.current.count).toBe(24);
    act(() => result.current.revealTo(25));
    expect(result.current.count).toBe(36);
  });

  it('keeps its count when the list changes, never shrinking the page', () => {
    const { result, rerender } = renderHook(({ total }) => useRevealedCount(total, 6), {
      initialProps: { total: 30 },
    });
    act(() => result.current.showMore());
    rerender({ total: 8 });
    expect(result.current).toMatchObject({ count: 8, remaining: 0 });
    rerender({ total: 30 });
    expect(result.current).toMatchObject({ count: 12, remaining: 18 });
  });
});

// A stand-in IntersectionObserver whose callback the test drives.
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(...intersecting: boolean[]) {
    this.callback(
      intersecting.map((isIntersecting) => ({ isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

describe('useWhenVisible', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeObserver.instances = [];
  });

  // Renders the hook and hands the element to its callback ref, as React
  // does when the element mounts.
  function mount(onVisible: () => void, watchKey = 'k', margin?: number) {
    const el = document.createElement('div');
    const view = renderHook(
      ({ cb, key }) => useWhenVisible<HTMLDivElement>(cb, key, margin),
      { initialProps: { cb: onVisible, key: watchKey } },
    );
    act(() => view.result.current(el));
    return { ...view, el };
  }

  it('calls back when the element comes into range, not before', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const onVisible = vi.fn();
    const { el } = mount(onVisible);
    const observer = FakeObserver.instances.at(-1)!;
    expect(observer.observed).toEqual([el]);
    expect(observer.options?.rootMargin).toBe('0px 0px 600px 0px');
    observer.fire(false);
    expect(onVisible).not.toHaveBeenCalled();
    observer.fire(false, true);
    expect(onVisible).toHaveBeenCalledOnce();
  });

  it('looks again when the watch key changes, and stops on unmount', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const onVisible = vi.fn();
    const view = mount(onVisible, 'a', 100);
    const first = FakeObserver.instances.at(-1)!;
    expect(first.options?.rootMargin).toBe('0px 0px 100px 0px');
    view.rerender({ cb: onVisible, key: 'b' });
    expect(first.disconnected).toBe(true);
    const second = FakeObserver.instances.at(-1)!;
    expect(second).not.toBe(first);
    view.unmount();
    expect(second.disconnected).toBe(true);
  });

  it('follows a replaced element (a view switch remounts it)', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const view = mount(vi.fn());
    const first = FakeObserver.instances.at(-1)!;
    const next = document.createElement('div');
    act(() => view.result.current(next));
    expect(first.disconnected).toBe(true);
    expect(FakeObserver.instances.at(-1)!.observed).toEqual([next]);
    act(() => view.result.current(null));
    expect(FakeObserver.instances.at(-1)!.disconnected).toBe(true);
  });

  it('uses the latest callback', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const before = vi.fn();
    const after = vi.fn();
    const view = mount(before);
    view.rerender({ cb: after, key: 'k' });
    FakeObserver.instances.at(-1)!.fire(true);
    expect(after).toHaveBeenCalledOnce();
    expect(before).not.toHaveBeenCalled();
  });

  it('does nothing without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(() => mount(vi.fn())).not.toThrow();
  });

  it('does nothing before the element exists', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    renderHook(() => useWhenVisible<HTMLDivElement>(vi.fn(), 'k'));
    expect(FakeObserver.instances).toHaveLength(0);
  });
});
