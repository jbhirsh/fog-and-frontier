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

const PIN_SIZE = 30;

// Circular "glyph" marker: a colored disc with a white border and a soft
// shadow, holding a white glyph — replacing the old rotated teardrop. Color
// still carries meaning (completion status / trip-day hue); only the shape and
// treatment changed. Stays an `L.divIcon` so it's the same mechanism the maps
// already use.
export function glyphPin(color: string, glyph: PinGlyph): L.DivIcon {
  const inner =
    'icon' in glyph
      ? `<span class="material-symbols-outlined" style="font-size:17px;color:#fff;font-variation-settings:'FILL' 1,'wght' 500,'GRAD' 0,'opsz' 20;">${glyph.icon}</span>`
      : `<span style="font-size:13px;font-weight:700;line-height:1;color:#fff;font-family:system-ui,-apple-system,sans-serif;">${glyph.text}</span>`;

  const html = `<div style="
    width:${PIN_SIZE}px;height:${PIN_SIZE}px;
    border-radius:9999px;
    background:${color};
    border:2.5px solid #fff;
    box-shadow:0 1px 4px rgba(0,0,0,0.30),0 0 0 0.5px rgba(0,0,0,0.06);
    display:flex;align-items:center;justify-content:center;
  ">${inner}</div>`;

  return L.divIcon({
    html,
    // Custom class so Leaflet's default `.leaflet-div-icon` white box/border is
    // not applied (the circle is our entire visual).
    className: 'glyph-pin',
    iconSize: [PIN_SIZE, PIN_SIZE],
    // Center anchor — a circle has no point, unlike the old teardrop.
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
    popupAnchor: [0, -(PIN_SIZE / 2) - 2],
  });
}
