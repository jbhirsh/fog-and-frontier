import * as L from 'leaflet';
import type { Category } from '../data/types';
import { isWithinBounds, type MapBounds } from './mapBounds';
import { GROUP_MAX_SIZE, groupSize } from './pinGroups';
import { glyphNudge } from './iconMetrics';

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
const CARTO_TILE_BASE = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export function cartoTileUrl(apiKey: string | undefined): string {
  const key = apiKey?.trim();
  return key ? `${CARTO_TILE_BASE}?key=${encodeURIComponent(key)}` : CARTO_TILE_BASE;
}

export const CARTO_TILE_URL = cartoTileUrl(import.meta.env.VITE_CARTO_API_KEY);

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
    (p) => p.miles <= MINOR_PIN_MILES && (bounds === null || isWithinBounds(p.lat, p.lng, bounds)),
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

// A glyph pin's markup, which homePin wraps with its badge.
// A count or a pin's number: the app's text face (its 600 weight, which the
// page loads), trimmed to the digits' height, so they sit in the middle of
// the circle rather than a pixel high, as a line box's room for descenders
// would put them.
const COUNT_STYLE =
  'font-weight:600;line-height:1;color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;text-box:trim-both cap alphabetic;';

function glyphPinHtml(color: string, glyph: PinGlyph, opts: PinOptions = {}): string {
  const { highlighted = false } = opts;
  const size = highlighted ? PIN_SIZE_HIGHLIGHTED : PIN_SIZE;
  // Whole pixels, the circle less its border leaving an even margin around
  // the glyph, so it lands on the pixel grid rather than blurring across it.
  const iconFontSize = highlighted ? 22 : 18;
  const textFontSize = highlighted ? 16 : 13;
  const border = highlighted ? 3 : 2;
  const shadow = highlighted
    ? '0 4px 12px rgba(0,0,0,0.45),0 0 0 0.5px rgba(0,0,0,0.08)'
    : '0 1px 4px rgba(0,0,0,0.30),0 0 0 0.5px rgba(0,0,0,0.06)';

  const inner =
    'icon' in glyph
      ? `<span class="material-symbols-outlined" style="font-size:${iconFontSize}px;color:#fff;font-variation-settings:'FILL' 1,'wght' 500,'GRAD' 0,'opsz' 20;${glyphNudge(glyph.icon)}">${glyph.icon}</span>`
      : `<span style="font-size:${textFontSize}px;${COUNT_STYLE}">${glyph.text}</span>`;

  return `<div style="
    width:${size}px;height:${size}px;
    border-radius:9999px;
    background:${color};
    border:${border}px solid #fff;
    box-shadow:${shadow};
    display:flex;align-items:center;justify-content:center;
  ">${inner}</div>`;
}

// Circular "glyph" marker: a colored disc with a white border and a soft
// shadow, holding a white glyph — replacing the old rotated teardrop. Color
// still carries meaning (completion status / trip-day hue); only the shape and
// treatment changed. Stays an `L.divIcon` so it's the same mechanism the maps
// already use.
export function glyphPin(color: string, glyph: PinGlyph, opts: PinOptions = {}): L.DivIcon {
  const size = opts.highlighted ? PIN_SIZE_HIGHLIGHTED : PIN_SIZE;
  const html = glyphPinHtml(color, glyph, opts);
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

// A group's circle (#291): the app's navy, so it reads apart from the status
// colors of single pins. A highlighted one (holding the card under the
// pointer, #94) takes the to-do blue as its ring, staying the same size so
// it can't grow into a neighbour. A group of only far places (#109) is a
// small muted disc, stepping back as their dots do.
const GROUP_COLOR = '#001e37';
const GROUP_RING_HIGHLIGHTED = '#0ea5e9';
const MINOR_GROUP_COLOR = '#64748b';
const MINOR_GROUP_SIZE = 24;

// Home's badge: a disc (a pill past one figure) tucked onto the house's
// shoulder, inside the reach every marker keeps to.
const BADGE_SIZE = 16;
const BADGE_OUT = 3;

/**
 * The farthest any marker reaches from its point, in pixels: a highlighted
 * pin's 40px disc, a group at its widest, home with its badge, a far dot's
 * hit box. Twice this is at most GROUP_RADIUS_PX, the least distance between
 * markers, so none overlap (#291).
 */
export const MARKER_REACH_PX = Math.max(
  PIN_SIZE_HIGHLIGHTED / 2,
  GROUP_MAX_SIZE / 2,
  // The badge's far end-cap: its centre at the corner, plus its radius.
  Math.hypot(PIN_SIZE / 2 + BADGE_OUT - BADGE_SIZE / 2, PIN_SIZE / 2 + BADGE_OUT - BADGE_SIZE / 2) +
    BADGE_SIZE / 2,
  MINOR_HIT_SIZE / 2,
);

// Text a screen reader reads for a marker whose visible content is a count.
function label(text: string): string {
  return `<span class="sr-only">${text}</span>`;
}

/** A group of pins drawn as one circle with its count, sized by it, named by `name`. */
export function groupPin(
  count: number,
  name: string,
  opts: PinOptions & { minor?: boolean } = {},
): L.DivIcon {
  const size = opts.minor ? MINOR_GROUP_SIZE : groupSize(count);
  const ring = opts.highlighted ? `3px solid ${GROUP_RING_HIGHLIGHTED}` : '2px solid #fff';
  const fontSize = opts.minor || count > 99 ? 11 : 14;
  const html = `<div style="
    width:${size}px;height:${size}px;
    border-radius:9999px;
    background:${opts.minor ? MINOR_GROUP_COLOR : GROUP_COLOR};
    border:${ring};
    box-shadow:0 2px 6px rgba(0,0,0,0.35);
    display:flex;align-items:center;justify-content:center;
  "><span aria-hidden="true" style="font-size:${fontSize}px;${COUNT_STYLE}">${count}</span>${label(name)}</div>`;
  return L.divIcon({
    html,
    className: 'glyph-pin pin-group',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Home's pin holding the places beside it at this zoom (#291): its house,
 * with their count in a small navy badge at its shoulder, named by `name`.
 * None beside it, it's the plain pin. Highlighted (a card beside it hovered,
 * #94), the badge turns to-do blue.
 */
export function homePin(
  color: string,
  nearby: number,
  name = '',
  opts: PinOptions = {},
): L.DivIcon {
  const pin = glyphPin(color, { icon: 'home' });
  if (nearby === 0) return pin;
  const house = glyphPinHtml(color, { icon: 'home' });
  const badge = `<span aria-hidden="true" style="
    position:absolute;top:-${BADGE_OUT}px;right:-${BADGE_OUT}px;
    min-width:${BADGE_SIZE}px;height:${BADGE_SIZE}px;padding:0 3px;box-sizing:border-box;
    border-radius:9999px;background:${opts.highlighted ? GROUP_RING_HIGHLIGHTED : GROUP_COLOR};
    border:1.5px solid #fff;
    display:flex;align-items:center;justify-content:center;
    font-size:10px;${COUNT_STYLE}
  ">${nearby}</span>`;
  return L.divIcon({
    ...pin.options,
    html: `<div style="position:relative;">${house}${badge}${label(name)}</div>`,
    className: 'glyph-pin pin-group',
  });
}
