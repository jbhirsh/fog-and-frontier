import { useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Trip } from '../lib/userTrips';
import { dayCount, dayLabel, formatHHMM } from '../lib/userTrips';
import { HOME_LOCATION } from '../data/home';
import { MapZoomControls } from './MapZoomControls';
import { CARTO_TILE_URL, glyphPin } from '../lib/mapPins';
import { MapCredit } from './MapCredit';
import { WORLD_BOUNDS } from '../lib/mapFit';

// A hue for each day's pins, cycling past eight days.
const DAY_COLORS = [
  '#0ea5e9',
  '#f97316',
  '#16a34a',
  '#a855f7',
  '#dc2626',
  '#0891b2',
  '#ca8a04',
  '#db2777',
];

function colorForDay(dayIndex: number): string {
  return DAY_COLORS[dayIndex % DAY_COLORS.length];
}

type Props = {
  trip: Trip;
};

/**
 * A trip's Map tab (#294): the map alone, every day's timed places on it,
 * each pin numbered and coloured by its day, as tall as the screen allows.
 */
export function TripMap({ trip }: Props) {
  // Timed places on one of the trip's days (not one its dates no longer reach).
  const places = useMemo(() => {
    const days = dayCount(trip);
    return trip.activities.flatMap((activity) => {
      const dayIndex = activity.day_index;
      return dayIndex !== null && dayIndex < days && activity.start_time
        ? [{ activity, dayIndex }]
        : [];
    });
  }, [trip]);

  return (
    <>
      {/* isolate: Leaflet's panes stack inside the map, under the phone's tab
          bar, rather than over it. */}
      <div className="relative isolate flex h-[calc(100dvh-var(--tab-bar)-17rem)] min-h-80 flex-col overflow-hidden rounded-xl border border-outline-variant/30 shadow-sm">
        <MapContainer
          center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
          zoom={8}
          // Pins are drawn on one copy of the world: panning onto the next
          // copy jumps back to that one.
          worldCopyJump
          // No grey past the poles (MapZoomControls keeps the zoom from it).
          maxBounds={WORLD_BOUNDS}
          maxBoundsViscosity={1}
          scrollWheelZoom
          zoomControl={false}
          // The tiles' credit is MapCredit's ⓘ, below.
          attributionControl={false}
          style={{ flex: 1, width: '100%' }}
        >
          <TileLayer url={CARTO_TILE_URL} />
          <MapZoomControls />
          {places.map(({ activity, dayIndex }) => {
            const coords = activity.snapshot?.location?.coords;
            if (!coords) return null;
            return (
              <Marker
                key={activity.id}
                position={[coords.lat, coords.lng]}
                icon={glyphPin(colorForDay(dayIndex), { text: String(dayIndex + 1) })}
              >
                <Popup>
                  <div className="min-w-[180px] space-y-xs">
                    <div className="font-bold">{activity.snapshot?.name}</div>
                    <div className="text-sm text-on-surface-variant">
                      {dayLabel(trip, dayIndex)} ·{' '}
                      {activity.start_time ? formatHHMM(activity.start_time) : 'unscheduled'}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        <MapCredit />
      </div>
    </>
  );
}
