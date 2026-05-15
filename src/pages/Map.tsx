import { useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ActivityDetail } from '../components/ActivityDetail';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import type { Activity } from '../data/types';
import { useAllActivities } from '../lib/userActivities';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';

const COLORS = {
  completed: '#16a34a',
  pending: '#0ea5e9',
  home: '#dc2626',
};

function pinIcon(color: string, label: string) {
  const html = `<div style="
    width: 28px; height: 28px;
    background: ${color};
    border: 2px solid white;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    display: flex; align-items: center; justify-content: center;
  "><span style="
    transform: rotate(45deg);
    font-size: 14px; font-weight: 700; color: white;
    font-family: system-ui, sans-serif;
  ">${label}</span></div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

const homeIcon = pinIcon(COLORS.home, '⌂');
const completedIcon = pinIcon(COLORS.completed, '✓');
const pendingIcon = pinIcon(COLORS.pending, '');

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
        <div className="flex-1 min-h-[500px] rounded-xl overflow-hidden border border-outline-variant/30 shadow-sm">
          <MapContainer
            center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
            zoom={8}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
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
                icon={completed ? completedIcon : pendingIcon}
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
