import { useEffect, useState } from 'react';

/** How many columns a computed `grid-template-columns` lays out; at least one. */
export function columnsOf(template: string): number {
  const tracks = template.trim();
  return tracks ? tracks.split(/\s+/).length : 1;
}

/**
 * How many columns a CSS grid has right now, as its breakpoints decide:
 * a ref for the grid, and its count, read again whenever it resizes. One
 * until it's measured (and where nothing can measure it).
 */
export function useGridColumns<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    if (!el) return;
    const read = () => setColumns(columnsOf(getComputedStyle(el).gridTemplateColumns));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, columns];
}

/**
 * Where a section opened from the card at `index` goes in a grid of
 * `columns`: after the last card of that card's row, or after the last card
 * shown when the row isn't full.
 */
export function rowEnd(index: number, columns: number, shown: number): number {
  return Math.min(shown - 1, (Math.floor(index / columns) + 1) * columns - 1);
}
