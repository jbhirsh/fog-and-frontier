// Map tiles by their place in the tile grid, `z/x/y` (#338). The app draws
// CARTO's tiles, which need production's key, and the location picker
// OpenStreetMap's, so the tools that stand in for the network answer either
// with OpenStreetMap's tile at the same place: the PR GIFs fetch it live
// (live-site.ts), the visual tests serve the copy committed in
// tests/visual/tiles/.

// CARTO's ({a-d}.basemaps.cartocdn.com/<style>/z/x/y[@2x].png, any query) and
// OpenStreetMap's ([{a-c}.]tile.openstreetmap.org/z/x/y.png).
const TILE =
  /^https:\/\/(?:[a-d]\.basemaps\.cartocdn\.com\/[^/?#]+|(?:[a-c]\.)?tile\.openstreetmap\.org)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(?:@2x)?\.png(?:[?#]|$)/;

/** A CARTO or OpenStreetMap tile's place, `z/x/y`, or null if the URL isn't a tile. */
export function tileOf(url: string): string | null {
  const match = TILE.exec(url);
  return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : null;
}

/** OpenStreetMap's standard tile at `z/x/y`. */
export function osmTileUrl(tile: string): string {
  return `https://tile.openstreetmap.org/${tile}.png`;
}
