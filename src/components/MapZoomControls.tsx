import { useEffect, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Custom frosted zoom controls, replacing Leaflet's default `zoomControl`. The
// MapContainer is mounted with `zoomControl={false}` and renders this as a
// child so `useMap()` has the map in context. Shared across every map. See #88.
//
// `topInset` pushes the controls down when the map is a full-screen backdrop
// under the slim app header (mobile map mode, #96), so they aren't buried.
export function MapZoomControls({ topInset = 12 }: { topInset?: number }) {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => map.getZoom());

  // Mirror Leaflet's default control: disable a button once the map is at its
  // zoom limit. Keep it in sync as the user zooms (buttons, wheel, pinch).
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const atMax = zoom >= map.getMaxZoom();
  const atMin = zoom <= map.getMinZoom();

  // Stop clicks/scrolls on the buttons from reaching the map underneath (would
  // otherwise pan or box-zoom). Leaflet's own helpers handle this cleanly.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  return (
    <div
      ref={ref}
      // Top-right, clear of the attribution control Leaflet renders bottom-right.
      // Positioning is inline (not Tailwind utilities) on purpose: Leaflet's
      // stylesheet is imported unlayered, and unlayered rules beat Tailwind v4's
      // layered utilities, so a layered `absolute`/`z-` would lose. Inline wins.
      style={{ position: 'absolute', right: 12, top: topInset, zIndex: 1000 }}
      className="flex flex-col overflow-hidden rounded-lg border border-white/50 bg-white/70 shadow-md backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Zoom in"
        disabled={atMax}
        onClick={() => map.zoomIn()}
        className="flex h-9 w-9 items-center justify-center text-on-surface hover:bg-white/60 disabled:cursor-not-allowed disabled:text-on-surface/30 disabled:hover:bg-transparent"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          add
        </span>
      </button>
      <div aria-hidden="true" className="h-px bg-black/10" />
      <button
        type="button"
        aria-label="Zoom out"
        disabled={atMin}
        onClick={() => map.zoomOut()}
        className="flex h-9 w-9 items-center justify-center text-on-surface hover:bg-white/60 disabled:cursor-not-allowed disabled:text-on-surface/30 disabled:hover:bg-transparent"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          remove
        </span>
      </button>
    </div>
  );
}
