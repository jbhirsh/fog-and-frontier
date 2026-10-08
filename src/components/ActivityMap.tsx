import { useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Tooltip } from 'react-leaflet';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapZoomControls } from './MapZoomControls';
import { BoundsWatcher, FitToActivities } from './MapViewport';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import type { Activity, Category } from '../data/types';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
import { createMoveGate, type MapBounds } from '../lib/mapBounds';
import {
  CARTO_ATTRIBUTION,
  CARTO_TILE_URL,
  CATEGORY_ICON,
  glyphPin,
} from '../lib/mapPins';

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

// Pick the icon for an activity pin. The common (un-highlighted) case reuses the
// memoized status icons above; the highlighted variant is rare (one at a time)
// so a fresh `glyphPin` per render is fine and avoids polluting the shared cache
// (#94).
function activityIcon(
  a: Activity,
  completed: boolean,
  highlighted: boolean,
): L.DivIcon {
  if (!highlighted) {
    return completed ? completedIcon : pendingIcon(a.category);
  }
  const color = completed ? COLORS.completed : COLORS.pending;
  const glyph = completed
    ? { icon: 'check' as const }
    : { icon: CATEGORY_ICON[a.category] };
  return glyphPin(color, glyph, { highlighted });
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
  /** Notified when a pin gains/loses hover (#94): the split view outlines the
   * matching card. `null` when the pointer leaves the pin. */
  onPinHoverChange?: (activity: Activity | null) => void;
  /**
   * Called ~400 ms after the map settles from a pan/zoom, with the current
   * viewport as normalized {@link MapBounds}. The split view uses this to
   * refilter the list to what's visible (#95). Must be referentially stable
   * (e.g. `useCallback`) so the debounce isn't recreated each render. Omit to
   * disable bounds reporting.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
  /**
   * Drop the rounded corners, border and shadow so the map sits edge to edge
   * as a full-screen backdrop (the mobile map, #96), and lift the zoom
   * controls, legend and attribution clear of the app header and the list
   * sheet. Default `false` keeps the framed look of Split and desktop Map.
   */
  fullBleed?: boolean;
  /**
   * Bump to fly the map out to fit every plotted activity (#106): "Clear
   * bounds" does, so the map and the list agree again. Only a change is a
   * request; the value the map mounts with isn't.
   */
  fitSignal?: number;
}

/**
 * The shared interactive map surface: CARTO basemap, frosted zoom controls, a
 * home marker, and one glyph pin per activity (green = completed, blue = to-do,
 * colored by category). Fills its parent — the parent sets the height (full
 * page in Map mode, the sticky right column in Split mode). See #4 / #93.
 *
 * #93 is layout-only: pins render statically and a popup links to detail. The
 * linked card↔pin hover behaviour is #94.
 */
export function ActivityMap({
  activities,
  onSelect,
  onActivate,
  highlightedId,
  onPinHoverChange,
  onBoundsChange,
  fullBleed = false,
  fitSignal = 0,
}: Props) {
  const overrides = useOverrides();
  const origin = useDistanceOrigin();
  // Shared by the fit and the bounds watcher, so the fit's own flight isn't
  // reported back as a pan that re-applies the bounds filter (#106).
  const [moveGate] = useState(createMoveGate);

  const plotted = useMemo(
    () =>
      activities.map((a) => ({
        a,
        completed: isEffectivelyCompleted(a, overrides),
        miles: distanceMiles(origin.coords, a.location.coords),
      })),
    [activities, overrides, origin],
  );

  // `isolate` traps Leaflet's pane z-indices (markers at 600, controls at
  // 1000) inside the map's own stacking context, so a page-level overlay like
  // the mobile list sheet (#96) paints above the map instead of having pins
  // punch through it.
  return (
    <div
      className={`relative isolate h-full w-full overflow-hidden ${
        fullBleed
          ? 'leaflet-fullbleed'
          : 'rounded-xl border border-outline-variant/30 shadow-sm'
      }`}
    >
      <MapContainer
        center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
        zoom={8}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_TILE_URL} />
        {/* In full bleed the map runs under the app header: clear its slim
            mobile form (about 60px) and its 80px md+ row. */}
        <MapZoomControls topInset={fullBleed ? 88 : 12} />
        {onBoundsChange && (
          <BoundsWatcher onBoundsChange={onBoundsChange} gate={moveGate} />
        )}
        <FitToActivities
          signal={fitSignal}
          activities={activities}
          // Keep fitted pins clear of the header and the zoom controls above
          // and of the legend below. Full bleed, the legend sits above the
          // peeking sheet and the attribution (bottom 152px, about 36px tall).
          padding={
            fullBleed ? { top: 100, bottom: 200 } : { top: 48, bottom: 56 }
          }
          gate={moveGate}
        />
        {/* Where distances are measured from (#66): the visitor, or home. */}
        <Marker position={[origin.coords.lat, origin.coords.lng]} icon={homeIcon}>
          <Popup>
            {origin.source === 'device' ? (
              <div className="font-bold">You are here</div>
            ) : (
              <>
                <div className="font-bold">{origin.label}</div>
                <div className="text-on-surface-variant">Home base</div>
              </>
            )}
          </Popup>
        </Marker>
        {plotted.map(({ a, completed, miles }) => {
          const highlighted = a.id === highlightedId;
          return (
            <Marker
              key={a.id}
              position={[a.location.coords.lat, a.location.coords.lng]}
              icon={activityIcon(a, completed, highlighted)}
              // Raise the highlighted pin above its neighbours so the enlarged
              // disc isn't clipped by adjacent markers (#94).
              zIndexOffset={highlighted ? 1000 : 0}
              eventHandlers={{
                ...(onActivate ? { click: () => onActivate(a) } : {}),
                // Pin hover → outline the matching card in the list (#94).
                mouseover: () => onPinHoverChange?.(a),
                mouseout: () => onPinHoverChange?.(null),
              }}
            >
              {/* Brief hover tooltip — the activity title (#94). */}
              <Tooltip direction="top" offset={[0, -6]}>
                {a.name}
              </Tooltip>
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
                      {a.location.city} · {Math.round(miles)} mi from{' '}
                      {origin.name} · {a.duration}
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
      {/* In full bleed the list sheet covers the bottom 7rem even at peek,
          and Leaflet's attribution sits just above it (index.css); stack the
          legend above that line, since on a phone the two are wide enough to
          overlap and the attribution must stay readable. */}
      <MapLegend bottomInset={fullBleed ? 152 : 12} />
    </div>
  );
}

// Frosted color key, ported from the old standalone Map page so status stays
// discoverable (color carries meaning). Positioned with inline styles + a high
// z-index for the same reason MapZoomControls does: Leaflet's unlayered CSS
// would otherwise beat Tailwind v4's layered utilities. Sits bottom-left, clear
// of Leaflet's bottom-right attribution and the top-right zoom controls.
function MapLegend({ bottomInset }: { bottomInset: number }) {
  return (
    <div
      style={{ position: 'absolute', left: 12, bottom: bottomInset, zIndex: 1000 }}
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
