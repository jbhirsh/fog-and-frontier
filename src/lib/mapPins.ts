import L from 'leaflet';
import type { Category } from '../data/types';

// Shared map surface styling for every Leaflet map in the app (the standalone
// `/map`, each trip's `TripMap`, and the #4 split view later). Keep the basemap
// and the pin treatment here so all maps stay visually identical and there's a
// single place to evolve the look. See issue #88.

// CARTO Positron — a light, minimal raster basemap, the closest free match to
// the Apple-Maps look from the #4 mockups. No API key; attribution required
// (OSM data + CARTO styling). The `{r}` token serves @2x tiles on retina.
export const CARTO_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Material Symbols glyph per category, used as the semantic icon inside a pin.
// Mirrors the category icons on ActivityCard so a place reads the same on the
// map as it does in the catalog.
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
// its shadow so the pin matching a hovered/focused card stands out; `pulse`
// adds a one-shot scale animation (keyframes in index.css) used when a card
// click flies the map to its pin.
export interface PinOptions {
  highlighted?: boolean;
  pulse?: boolean;
}

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
  const { highlighted = false, pulse = false } = opts;
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
    // not applied (the circle is our entire visual). `glyph-pin--pulse` adds the
    // one-shot fly-to animation (see index.css).
    className: pulse ? 'glyph-pin glyph-pin--pulse' : 'glyph-pin',
    iconSize: [size, size],
    // Center anchor — a circle has no point, unlike the old teardrop.
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2) - 2],
  });
}
