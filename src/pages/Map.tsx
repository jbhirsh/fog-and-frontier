import { useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ActivityDetail } from '../components/ActivityDetail';
import { MapZoomControls } from '../components/MapZoomControls';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import type { Activity, Category } from '../data/types';
import { useAllActivities } from '../lib/userActivities';
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

export function Map() {
  const all = useAllActivities();
  const overrides = useOverrides();
  const [selected, setSelected] = useState<Activity | null>(null);

  const activitiesWithDistance = useMemo(
    () =>
      all.map((a) => ({
        a,
        completed: isEffectivelyCompleted(a, overrides),
        miles: distanceMiles(HOME_LOCATION.coords, a.location.coords),
      })),
    [all, overrides],
  );

  const completedCount = activitiesWithDistance.filter(
    (x) => x.completed,
  ).length;

  return (
    <div className="flex flex-col min-h-dvh">
      <section className="px-margin py-lg bg-surface-container-low border-b border-outline-variant/20">
        <div className="max-w-screen-2xl mx-auto flex items-baseline justify-between flex-wrap gap-md">
          <div>
            <h1 className="font-display text-headline-lg md:text-display text-primary">Map</h1>
            <p className="font-body-md text-on-surface-variant">
              {all.length} place{all.length === 1 ? '' : 's'} ·{' '}
              {completedCount} completed · home base{' '}
              {HOME_LOCATION.label}
            </p>
          </div>
          <div className="flex items-center gap-md text-body-sm text-on-surface-variant">
            <Legend color={COLORS.home} label="Home" />
            <Legend color={COLORS.completed} label="Completed" />
            <Legend color={COLORS.pending} label="To do" />
          </div>
        </div>
      </section>

      <section className="flex-1 flex flex-col px-margin py-md w-full max-w-screen-2xl mx-auto">
        <div className="flex-1 flex flex-col min-h-[500px] rounded-xl overflow-hidden border border-outline-variant/30 shadow-sm">
          <MapContainer
            center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
            zoom={8}
            scrollWheelZoom
            zoomControl={false}
            style={{ flex: 1, width: '100%' }}
          >
            <TileLayer
              attribution={CARTO_ATTRIBUTION}
              url={CARTO_TILE_URL}
            />
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
            {activitiesWithDistance.map(({ a, completed, miles }) => (
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
                      onClick={() => setSelected(a)}
                      className="inline-flex items-center min-h-11 text-primary font-bold underline cursor-pointer"
                    >
                      View details →
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </section>

      {selected && (
        <ActivityDetail
          activity={selected}
          onClose={() => setSelected(null)}
          showUploads={!!selected.completed}
        />
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-xs">
      <span
        aria-hidden="true"
        style={{ background: color }}
        className="w-3 h-3 rounded-full inline-block"
      />
      {label}
    </span>
  );
}
