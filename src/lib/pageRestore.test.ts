import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOnPageRestore } from './pageRestore';

// Back to a page the browser kept (its back-forward cache), and only then.

const pageshow = (persisted: boolean) => {
  const event = new Event('pageshow') as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
};

describe('useOnPageRestore', () => {
  it('calls back when the page comes back from the back-forward cache', () => {
    const onRestore = vi.fn();
    renderHook(() => useOnPageRestore(onRestore));
    pageshow(true);
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it('stays quiet for a page loaded afresh', () => {
    const onRestore = vi.fn();
    renderHook(() => useOnPageRestore(onRestore));
    pageshow(false);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('calls the latest callback, and none once unmounted', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ cb }) => useOnPageRestore(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    pageshow(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    unmount();
    pageshow(true);
    expect(second).toHaveBeenCalledOnce();
  });
});
