import L from 'leaflet';
import type { Category } from '../data/types';
import { isWithinBounds, type MapBounds } from './mapBounds';

// Shared map surface styling for every Leaflet map in the app (the standalone
// `/map`, each trip's `TripMap`, and the #4 split view later). Keep the basemap
// and the pin treatment here so all maps stay visually identical and there's a
// single place to evolve the look. See issue #88.

// CARTO Positron — a light, minimal raster basemap, the closest free match to
// the Apple-Maps look from the #4 mockups. Attribution required (OSM data +
// CARTO styling). The `{r}` token serves @2x tiles on retina.
//
// CARTO now requires a (free) API key on every tile request: keyless requests
// still return 200 but with "API KEY REQUIRED" baked into the image. The key
// is a `?key=` query param and is meant to be public (it ships in every tile
// URL), so it lives in a `VITE_` env var. Request one at
// https://carto.com/basemaps/apikey and restrict it to the app's domains in
// the CARTO dashboard.
const CARTO_TILE_BASE =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export function cartoTileUrl(apiKey: string | undefined): string {
  const key = apiKey?.trim();
  return key ? `${CARTO_TILE_BASE}?key=${encodeURIComponent(key)}` : CARTO_TILE_BASE;
}

export const CARTO_TILE_URL = cartoTileUrl(
  import.meta.env.VITE_CARTO_API_KEY as string | undefined,
);

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Material Symbols glyph per category: the semantic icon inside a pin, and the
// single source for ActivityCard's category pill and the CoverImage fallback,
// so a place reads the same on the map as it does in the catalog.
export const CATEGORY_ICON: Record<Category, string> = {
  hiking: 'directions_walk',
  cycling: 'pedal_bike',
  water: 'water',
  food: 'restaurant',
  culture: 'museum',
  scenic: 'landscape',
  climbing: 'terrain',
  camping: 'forest',
  other: 'explore',
};

// A pin's content is either a Material Symbols icon (semantic/category glyph) or
// a short bit of text (a number, a ✓ — anything that fits in the circle).
export type PinGlyph = { icon: string } | { text: string };

// Visual variants of a pin (#94). `highlighted` enlarges the disc and deepens
// its shadow so the pin matching a hovered/focused card stands out.
export interface PinOptions {
  highlighted?: boolean;
}

// Past this many miles from the distance origin (home, or the visitor), an
// activity's pin is a minor dot. It's the "Within 100 mi" step of the catalog's
// distance filter, about the edge of a day trip. It moves with the origin, so
// "far" always means far from where the visitor measures from.
export const MINOR_PIN_MILES = 100;

/**
 * Whether the map shows a near pin (within {@link MINOR_PIN_MILES}) in the
 * viewport, or anywhere before the viewport is known. Far pins only shrink
 * beside a near one: a map of only far places (zoomed into Oregon, say, or a
 * visitor far from the West Coast) keeps every pin whole, since there's
 * nothing nearer for them to step back from.
 */
export function hasNearPinInView(
  pins: readonly { lat: number; lng: number; miles: number }[],
  bounds: MapBounds | null,
): boolean {
  return pins.some(
    (p) =>
      p.miles <= MINOR_PIN_MILES &&
      (bounds === null || isWithinBounds(p.lat, p.lng, bounds)),
  );
}

/**
 * Whether an activity's pin draws as a minor dot: it's more than
 * {@link MINOR_PIN_MILES} from the origin, a near pin is in view (see
 * {@link hasNearPinInView}), and it isn't active. An active one (its card
 * hovered or focused, or the pin hovered) is a full pin, so it can be found
 * and read.
 */
export function isMinorPin(miles: number, active: boolean, nearInView: boolean): boolean {
  return nearInView && !active && miles > MINOR_PIN_MILES;
}

/**
 * A pin's `zIndexOffset`: a raised one (highlighted or hovered) sits above its
 * neighbours so its larger disc isn't clipped (#94), and minor dots sit under
 * the full pins (#109).
 */
export function pinZIndex(raised: boolean, minor: boolean): number {
  if (raised) return 1000;
  return minor ? -1000 : 0;
}

// The visible dot, and the box around it that takes the hover and tap: a
// bare 10px dot would be too small a target. 24px is WCAG 2.2's minimum.
const MINOR_DOT_SIZE = 10;
const MINOR_HIT_SIZE = 24;

const PIN_SIZE = 30;
// Highlighted pins grow so a hovered card's match reads instantly against its
// neighbours; the caller also lifts them with `zIndexOffset` so they sit above.
const PIN_SIZE_HIGHLIGHTED = 40;

// Circular "glyph" marker: a colored disc with a white border and a soft
// shadow, holding a white glyph — replacing the old rotated teardrop. Color
// still carries meaning (completion status / trip-day hue); only the shape and
// treatment changed. Stays an `L.divIcon` so it's the same mechanism the maps
// already use.
export function glyphPin(
  color: string,
  glyph: PinGlyph,
  opts: PinOptions = {},
): L.DivIcon {
  const { highlighted = false } = opts;
  const size = highlighted ? PIN_SIZE_HIGHLIGHTED : PIN_SIZE;
  const iconFontSize = highlighted ? 22 : 17;
  const textFontSize = highlighted ? 16 : 13;
  const border = highlighted ? 3 : 2.5;
  const shadow = highlighted
    ? '0 4px 12px rgba(0,0,0,0.45),0 0 0 0.5px rgba(0,0,0,0.08)'
    : '0 1px 4px rgba(0,0,0,0.30),0 0 0 0.5px rgba(0,0,0,0.06)';

  const inner =
    'icon' in glyph
      ? `<span class="material-symbols-outlined" style="font-size:${iconFontSize}px;color:#fff;font-variation-settings:'FILL' 1,'wght' 500,'GRAD' 0,'opsz' 20;">${glyph.icon}</span>`
      : `<span style="font-size:${textFontSize}px;font-weight:700;line-height:1;color:#fff;font-family:system-ui,-apple-system,sans-serif;">${glyph.text}</span>`;

  const html = `<div style="
    width:${size}px;height:${size}px;
    border-radius:9999px;
    background:${color};
    border:${border}px solid #fff;
    box-shadow:${shadow};
    display:flex;align-items:center;justify-content:center;
  ">${inner}</div>`;

  return L.divIcon({
    html,
    // Custom class so Leaflet's default `.leaflet-div-icon` white box/border is
    // not applied (the circle is our entire visual).
    className: 'glyph-pin',
    iconSize: [size, size],
    // Center anchor — a circle has no point, unlike the old teardrop.
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2) - 2],
  });
}

/**
 * A far-away activity's pin (#109): its status color as a small dot with a
 * thin white ring and no glyph, centred in a larger transparent hit box, so
 * the map doesn't read as a wall of equal pins. See {@link isMinorPin}.
 */
export function minorPin(color: string): L.DivIcon {
  const html = `<div style="
    width:${MINOR_HIT_SIZE}px;height:${MINOR_HIT_SIZE}px;
    display:flex;align-items:center;justify-content:center;
  "><div style="
    width:${MINOR_DOT_SIZE}px;height:${MINOR_DOT_SIZE}px;
    border-radius:9999px;
    background:${color};
    border:1.5px solid #fff;
    box-shadow:0 1px 2px rgba(0,0,0,0.30);
  "></div></div>`;
  return L.divIcon({
    html,
    className: 'glyph-pin',
    iconSize: [MINOR_HIT_SIZE, MINOR_HIT_SIZE],
    iconAnchor: [MINOR_HIT_SIZE / 2, MINOR_HIT_SIZE / 2],
    popupAnchor: [0, -(MINOR_DOT_SIZE / 2) - 2],
  });
}
