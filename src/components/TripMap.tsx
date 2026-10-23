import { useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Trip, TripActivity } from '../lib/userTrips';
import { dayCount, dayLabel, formatHHMM } from '../lib/userTrips';
import { HOME_LOCATION } from '../data/home';
import { MapZoomControls } from './MapZoomControls';
import { CARTO_ATTRIBUTION, CARTO_TILE_URL, glyphPin } from '../lib/mapPins';

// Color cycle for "show all days" mode. Each day picks a hue; the same hue
// is used for the per-day label so the legend stays readable.
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

type DayBucket = {
  dayIndex: number;
  activities: TripActivity[];
};

export function TripMap({ trip }: Props) {
  const total = dayCount(trip);
  const buckets = useMemo<DayBucket[]>(() => {
    const out: DayBucket[] = [];
    for (let i = 0; i < total; i++) {
      out.push({
        dayIndex: i,
        activities: trip.activities
          .filter((a) => a.day_index === i && a.start_time)
          .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')),
      });
    }
    return out;
  }, [trip, total]);

  const [showAll, setShowAll] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const safeActiveDay = Math.min(activeDay, total - 1);

  const activitiesToShow = showAll
    ? buckets.flatMap((b) => b.activities.map((a) => ({ activity: a, dayIndex: b.dayIndex })))
    : (buckets[safeActiveDay]?.activities ?? []).map((a) => ({
        activity: a,
        dayIndex: safeActiveDay,
      }));

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-md">
        <div className="flex gap-xs overflow-x-auto" role="tablist" aria-label="Itinerary day">
          {buckets.map((b) => {
            const selected = !showAll && b.dayIndex === safeActiveDay;
            return (
              <button
                key={b.dayIndex}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setShowAll(false);
                  setActiveDay(b.dayIndex);
                }}
                className={`rounded-full border px-sm py-xs font-body-md text-sm whitespace-nowrap transition-colors ${
                  selected
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant'
                }`}
              >
                {dayLabel(trip, b.dayIndex)}
                {b.activities.length > 0 && (
                  <span className="ml-xs opacity-70">({b.activities.length})</span>
                )}
              </button>
            );
          })}
        </div>
        <label className="ml-auto inline-flex items-center gap-xs font-body-md text-sm text-on-surface-variant">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="accent-primary"
          />
          Show all days
        </label>
      </div>

      <div className="flex min-h-[400px] flex-col overflow-hidden rounded-xl border border-outline-variant/30 shadow-sm">
        <MapContainer
          center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
          zoom={8}
          scrollWheelZoom
          zoomControl={false}
          style={{ flex: 1, width: '100%' }}
        >
          <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_TILE_URL} />
          <MapZoomControls />
          {activitiesToShow.map(({ activity, dayIndex }, idx) => {
            const coords = activity.snapshot?.location?.coords;
            if (!coords) return null;
            const color = showAll ? colorForDay(dayIndex) : '#0ea5e9';
            const label = showAll ? String(dayIndex + 1) : String(idx + 1);
            return (
              <Marker
                key={activity.id}
                position={[coords.lat, coords.lng]}
                icon={glyphPin(color, { text: label })}
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
      </div>

      {showAll && (
        <div className="flex flex-wrap gap-md text-xs text-on-surface-variant">
          {buckets.map((b) => (
            <span key={b.dayIndex} className="flex items-center gap-xs">
              <span
                aria-hidden="true"
                style={{ background: colorForDay(b.dayIndex) }}
                className="inline-block size-3 rounded-full"
              />
              {dayLabel(trip, b.dayIndex)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
