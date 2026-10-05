/**
 * Pure snap-point math for the mobile map's draggable list sheet (#96). Kept
 * free of React and the DOM so the drag → snap resolution is unit-tested on
 * its own; `BottomSheet` only wires pointer and key events to these helpers.
 *
 * The three rest positions, Apple-Maps / Find-My style:
 *   - `peek`: just the grabber and the summary header; the map fills the screen.
 *   - `half`: the sheet covers the lower half; map and list share the screen.
 *   - `full`: the sheet covers almost the whole screen for browsing the list.
 */
export type SheetSnap = 'peek' | 'half' | 'full';

/** Rest heights in pixels for one viewport height. */
export type SnapHeights = Record<SheetSnap, number>;

// Pixel twins of SNAP_CSS below: peek is 7rem at the 16px root size, and the
// fractions match the half and full dvh heights.
const PEEK_PX = 112;
const HALF_FRACTION = 0.52;
const FULL_FRACTION = 0.9;

/**
 * CSS heights for the sheet at rest. Peek is fixed so the map stays dominant;
 * half and full follow the dynamic viewport, so the sheet scales with the
 * device and with mobile browser chrome. {@link snapHeights} is the pixel
 * equivalent the drag math works in.
 */
export const SNAP_CSS: Record<SheetSnap, string> = {
  peek: '7rem',
  half: '52dvh',
  full: '90dvh',
};

/**
 * Past this many pixels of travel a pointer gesture is a drag (snap to the
 * nearest rest position) rather than a tap (cycle), so a shaky tap still
 * cycles.
 */
export const DRAG_THRESHOLD_PX = 6;

/** Pixel rest heights for a viewport `viewportHeight` pixels tall. */
export function snapHeights(viewportHeight: number): SnapHeights {
  return {
    peek: PEEK_PX,
    half: Math.round(viewportHeight * HALF_FRACTION),
    full: Math.round(viewportHeight * FULL_FRACTION),
  };
}

const ORDER: readonly SheetSnap[] = ['peek', 'half', 'full'];

/**
 * The rest position closest to `height`. A height exactly between two rest
 * positions resolves to the lower one, so a release at the midpoint never
 * grows the sheet.
 */
export function nearestSnap(height: number, heights: SnapHeights): SheetSnap {
  return ORDER.reduce((best, snap) =>
    Math.abs(heights[snap] - height) < Math.abs(heights[best] - height)
      ? snap
      : best,
  );
}

/** Tap / Enter / Space on the grabber: peek → half → full → back to peek. */
export function cycleSnap(snap: SheetSnap): SheetSnap {
  return ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length];
}

/**
 * Arrow keys on the grabber: one step up (`1`) or down (`-1`), stopping at
 * the ends instead of wrapping.
 */
export function stepSnap(snap: SheetSnap, direction: 1 | -1): SheetSnap {
  const index = Math.min(
    Math.max(ORDER.indexOf(snap) + direction, 0),
    ORDER.length - 1,
  );
  return ORDER[index];
}

/**
 * Live sheet height while a drag is in progress. Dragging up (a smaller
 * `currentY`) grows the sheet; the result stays between the peek and full
 * rest heights.
 */
export function dragHeight(
  startHeight: number,
  startY: number,
  currentY: number,
  heights: SnapHeights,
): number {
  const next = startHeight + (startY - currentY);
  return Math.min(Math.max(next, heights.peek), heights.full);
}

/** Whether a pointer that moved from `startY` to `currentY` is a drag. */
export function isDrag(startY: number, currentY: number): boolean {
  return Math.abs(startY - currentY) > DRAG_THRESHOLD_PX;
}
