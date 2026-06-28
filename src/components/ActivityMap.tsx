import { useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapZoomControls } from './MapZoomControls';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import type { Activity, Category } from '../data/types';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
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

interface Props {
  /** Activities to plot — already filtered by the caller. */
  activities: Activity[];
  /** Open the detail modal for an activity (from a pin popup's "View details"). */
  onSelect: (activity: Activity) => void;
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
export function ActivityMap({ activities, onSelect }: Props) {
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
        <Marker
          position={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
          icon={homeIcon}
        >
          <Popup>
            <div className="font-bold">{HOME_LOCATION.label}</div>
            <div className="text-on-surface-variant">Home base</div>
          </Popup>
        </Marker>
        {plotted.map(({ a, completed, miles }) => (
          <Marker
            key={a.id}
            position={[a.location.coords.lat, a.location.coords.lng]}
            icon={completed ? completedIcon : pendingIcon(a.category)}
          >
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
          </Marker>
        ))}
      </MapContainer>
      <MapLegend />
    </div>
  );
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
