import { useCallback, useEffect, useRef, useState } from 'react';

// Incremental list rendering (#102): show one page of cards, add a page each
// time the end of the list comes into view, and grow to any card that has to
// be shown (a clicked map pin's). Filtering still runs over the whole list;
// this only limits how many of its cards are in the DOM.

/**
 * How many of `total` items to render: at least one page, growing a page at a
 * time. The count carries over when the list changes (new filters, a new map
 * area), so the page never shrinks under someone scrolled far down; it only
 * limits the first render, not later ones.
 */
export function useRevealedCount(total: number, pageSize: number) {
  const [revealed, setRevealed] = useState(pageSize);

  const showMore = useCallback(() => {
    setRevealed((r) => Math.max(r, pageSize) + pageSize);
  }, [pageSize]);

  // Never less than a page: a larger page (Split to List) fills its grid.
  const count = Math.min(total, Math.max(revealed, pageSize));

  /**
   * Make sure the item at `index` is rendered, rounding up to whole pages.
   * Returns how many will be, for laying out what's about to show.
   */
  const revealTo = useCallback(
    (index: number) => {
      const through = Math.ceil((index + 1) / pageSize) * pageSize;
      setRevealed((r) => Math.max(r, through));
      return Math.min(total, Math.max(count, through));
    },
    [count, pageSize, total],
  );
  return { count, remaining: total - count, showMore, revealTo };
}

/**
 * Calls `onVisible` when the element given to the returned callback ref comes
 * within `margin` px below the viewport (or inside a scrolling ancestor that
 * clips it). It looks again when the element is replaced (a view switch
 * remounts it) and whenever `watchKey` changes, so after a page is added with
 * the end still in view, the next page follows without waiting for a scroll.
 * No-op where IntersectionObserver is missing: a "Show more" button covers
 * that.
 */
export function useWhenVisible<T extends Element>(
  onVisible: () => void,
  watchKey: string,
  margin = 600,
) {
  const [el, setEl] = useState<T | null>(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  }, [onVisible]);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current();
      },
      { rootMargin: `0px 0px ${margin}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, margin, watchKey]);
  return setEl;
}
