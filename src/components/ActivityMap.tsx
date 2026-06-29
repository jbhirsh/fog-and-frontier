import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapZoomControls } from './MapZoomControls';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import type { Activity, Category } from '../data/types';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
import { debounce, type MapBounds } from '../lib/mapBounds';
import {
  CARTO_ATTRIBUTION,
  CARTO_TILE_URL,
  CATEGORY_ICON,
  glyphPin,
  type PinOptions,
} from '../lib/mapPins';

/** A fly-to request: clicking a card sets this; the bumped `nonce` re-triggers
 * the fly+pulse even when the same activity is clicked twice in a row (#94). */
export interface FocusTarget {
  id: string;
  nonce: number;
}

const COLORS = {
  completed: '#16a34a',
  pending: '#0ea5e9',
  home: '#dc2626',
};

// Status carries meaning via color: home (red), completed (green), pending
// (blue). The glyph reinforces it — a house for home, a check for completed,
// and the activity's category icon for pending (so you see what's still to do).
const homeIcon = glyphPin(COLORS.home, { icon: 'home' });
const completedIcon = glyphPin(COLORS.completed, { icon: 'check' });

const pendingIcons: Partial<Record<Category, L.DivIcon>> = {};
function pendingIcon(category: Category): L.DivIcon {
  return (pendingIcons[category] ??= glyphPin(COLORS.pending, {
    icon: CATEGORY_ICON[category],
  }));
}

// Pick the icon for an activity pin. The common (un-highlighted, un-pulsing)
// case reuses the memoized status icons above; the highlighted/pulsing variants
// are rare (one at a time) so a fresh `glyphPin` per render is fine and avoids
// polluting the shared cache (#94).
function activityIcon(
  a: Activity,
  completed: boolean,
  opts: PinOptions,
): L.DivIcon {
  if (!opts.highlighted && !opts.pulse) {
    return completed ? completedIcon : pendingIcon(a.category);
  }
  const color = completed ? COLORS.completed : COLORS.pending;
  const glyph = completed
    ? { icon: 'check' as const }
    : { icon: CATEGORY_ICON[a.category] };
  return glyphPin(color, glyph, opts);
}

interface Props {
  /** Activities to plot — already filtered by the caller. */
  activities: Activity[];
  /** Open the detail modal for an activity (from a pin popup's "View details"). */
  onSelect: (activity: Activity) => void;
  /**
   * Primary click handler for a pin (#94): a single click on the marker fires
   * this (the split view opens detail + scrolls the matching card into view).
   * The popup's "View details" calls it too when provided. Omit to fall back to
   * {@link onSelect}.
   */
  onActivate?: (activity: Activity) => void;
  /** Id of the activity whose pin should render highlighted (a hovered/focused
   * card, #94). Larger disc + raised above neighbours; does not open a popup. */
  highlightedId?: string | null;
  /** A fly-to request (#94). When its `nonce` changes the map flies to that
   * activity's pin and pulses it. */
  focusTarget?: FocusTarget | null;
  /**
   * Called ~400 ms after the map settles from a pan/zoom, with the current
   * viewport as normalized {@link MapBounds}. The split view uses this to
   * refilter the list to what's visible (#95). Must be referentially stable
   * (e.g. `useCallback`) so the debounce isn't recreated each render. Omit to
   * disable bounds reporting.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
}

/**
 * The shared interactive map surface: CARTO basemap, frosted zoom controls, a
 * home marker, and one glyph pin per activity (green = completed, blue = to-do,
 * colored by category). Fills its parent — the parent sets the height (full
 * page in Map mode, the sticky right column in Split mode). See #4 / #93.
 *
 * #93 is layout-only: pins render statically and a popup links to detail. The
 * linked card↔pin hover/fly behaviour is #94.
 */
export function ActivityMap({
  activities,
  onSelect,
  onActivate,
  highlightedId,
  focusTarget,
  onBoundsChange,
}: Props) {
  const overrides = useOverrides();

  const plotted = useMemo(
    () =>
      activities.map((a) => ({
        a,
        completed: isEffectivelyCompleted(a, overrides),
        miles: distanceMiles(HOME_LOCATION.coords, a.location.coords),
      })),
    [activities, overrides],
  );

  // The pin currently playing the one-shot fly-to pulse, set when `focusTarget`
  // changes and cleared ~700ms later (matches the CSS animation in index.css).
  // Tracked separately from the highlight so a card click pulses even when the
  // pointer has already left the card.
  const [pulseId, setPulseId] = useState<string | null>(null);
  const lastPulseNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastPulseNonce.current) return;
    lastPulseNonce.current = focusTarget.nonce;
    setPulseId(focusTarget.id);
    const t = window.setTimeout(() => setPulseId(null), 700);
    return () => window.clearTimeout(t);
  }, [focusTarget]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-outline-variant/30 shadow-sm">
      <MapContainer
        center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
        zoom={8}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_TILE_URL} />
        <MapZoomControls />
        {onBoundsChange && <BoundsWatcher onBoundsChange={onBoundsChange} />}
        <FocusFlyer focusTarget={focusTarget} activities={activities} />
        <Marker
          position={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
          icon={homeIcon}
        >
          <Popup>
            <div className="font-bold">{HOME_LOCATION.label}</div>
            <div className="text-on-surface-variant">Home base</div>
          </Popup>
        </Marker>
        {plotted.map(({ a, completed, miles }) => {
          const highlighted = a.id === highlightedId;
          const pulse = a.id === pulseId;
          return (
            <Marker
              key={a.id}
              position={[a.location.coords.lat, a.location.coords.lng]}
              icon={activityIcon(a, completed, { highlighted, pulse })}
              // Raise the highlighted/pulsing pin above its neighbours so the
              // enlarged disc isn't clipped by adjacent markers (#94).
              zIndexOffset={highlighted || pulse ? 1000 : 0}
              eventHandlers={
                onActivate ? { click: () => onActivate(a) } : undefined
              }
            >
              {/* When the parent wires `onActivate` (the split view), a pin
                  click opens detail + scrolls the card directly — rendering a
                  Popup too would double-open it and its autoPan would move the
                  map (firing an unwanted bounds refilter). Keep the Popup only
                  as the standalone fallback when there's no `onActivate`. */}
              {!onActivate && (
                <Popup>
                  <div className="space-y-xs min-w-[200px]">
                    <div className="font-bold text-body-md">{a.name}</div>
                    <div className="text-body-sm text-on-surface-variant">
                      {a.location.city} · {Math.round(miles)} mi · {a.duration}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelect(a)}
                      className="inline-flex items-center min-h-11 text-primary font-bold underline cursor-pointer"
                    >
                      View details →
                    </button>
                  </div>
                </Popup>
              )}
            </Marker>
          );
        })}
      </MapContainer>
      <MapLegend />
    </div>
  );
}

// Wrap a longitude into [-180, 180]. Leaflet's getWest()/getEast() can return
// values outside that range once the user pans across multiple world copies
// (e.g. west: -200); the activities use normalized longitudes, so the bounds
// must be normalized too before {@link isWithinBounds} compares them.
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

// Read the map's current viewport as normalized MapBounds. A viewport spanning
// a full world (or more) contains every longitude, so collapse it to the whole
// range rather than wrapping into a misleading antimeridian window.
function readBounds(map: L.Map): MapBounds {
  const b = map.getBounds();
  const north = b.getNorth();
  const south = b.getSouth();
  const rawWest = b.getWest();
  const rawEast = b.getEast();
  if (rawEast - rawWest >= 360) {
    return { north, south, west: -180, east: 180 };
  }
  return { north, south, west: wrapLng(rawWest), east: wrapLng(rawEast) };
}

// Reports the viewport to the parent ~400 ms after the map settles from a
// pan/zoom (#95). Lives inside MapContainer so `useMap()` has the map in
// context; renders nothing.
function BoundsWatcher({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: MapBounds) => void;
}) {
  const map = useMap();
  const debounced = useMemo(
    () => debounce(() => onBoundsChange(readBounds(map)), 400),
    [map, onBoundsChange],
  );
  useMapEvents({ moveend: debounced, zoomend: debounced });
  useEffect(() => () => debounced.cancel(), [debounced]);
  return null;
}

// Flies the map to a focused activity's pin when `focusTarget.nonce` changes
// (#94). Lives inside MapContainer so `useMap()` has the map in context;
// renders nothing. The `lastNonce` ref guards against the effect re-running for
// unrelated dependency changes (e.g. `activities` refiltering, which is needed
// in the dep array to satisfy exhaustive-deps) — we only fly on a *new* nonce.
function FocusFlyer({
  focusTarget,
  activities,
}: {
  focusTarget?: FocusTarget | null;
  activities: Activity[];
}) {
  const map = useMap();
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastNonce.current) return;
    lastNonce.current = focusTarget.nonce;
    const a = activities.find((x) => x.id === focusTarget.id);
    if (!a) return;
    map.flyTo(
      [a.location.coords.lat, a.location.coords.lng],
      Math.max(map.getZoom(), 12),
      { duration: 0.6 },
    );
  }, [focusTarget, activities, map]);
  return null;
}

// Frosted color key, ported from the old standalone Map page so status stays
// discoverable (color carries meaning). Positioned with inline styles + a high
// z-index for the same reason MapZoomControls does: Leaflet's unlayered CSS
// would otherwise beat Tailwind v4's layered utilities. Sits bottom-left, clear
// of Leaflet's bottom-right attribution and the top-right zoom controls.
function MapLegend() {
  return (
    <div
      style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 1000 }}
      className="flex items-center gap-md rounded-lg border border-white/50 bg-white/70 px-sm py-xs text-body-sm text-on-surface shadow-md backdrop-blur-sm"
    >
      <LegendDot color={COLORS.home} label="Home" />
      <LegendDot color={COLORS.completed} label="Completed" />
      <LegendDot color={COLORS.pending} label="To do" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-xs">
      <span
        aria-hidden="true"
        style={{ background: color }}
        className="inline-block h-3 w-3 rounded-full"
      />
      {label}
    </span>
  );
}
