// How far a map may zoom out (#291 follow-up): no further than the zoom at
// which the world, 256px tall at zoom 0 and doubling with each step, is at
// least as tall as the map, so it never shows grey above and below the
// world. Sideways the world repeats, so width sets no limit.

/** A Web Mercator tile's side, in px: the world's height at zoom 0. */
const TILE_PX = 256;

/** The latitude Web Mercator stops at, north and south. */
export const WORLD_EDGE_LAT = 85.0511;

/** The least zoom at which the world fills a map `height` px tall. */
export function fillZoom(height: number): number {
  if (!Number.isFinite(height) || height <= TILE_PX) return 0;
  return Math.ceil(Math.log2(height / TILE_PX));
}

/**
 * A map's maxBounds: the world's top and bottom edges, and no edge sideways,
 * where the world repeats (far past any pan, which worldCopyJump brings back).
 */
export const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-WORLD_EDGE_LAT, -1e5],
  [WORLD_EDGE_LAT, 1e5],
];
