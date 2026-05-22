import { useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Trip, TripActivity } from '../lib/userTrips';
import { dayCount, dayLabel, formatHHMM } from '../lib/userTrips';
import { HOME_LOCATION } from '../data/home';

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
    font-size: 12px; font-weight: 700; color: white;
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
    ? buckets.flatMap((b) =>
        b.activities.map((a) => ({ activity: a, dayIndex: b.dayIndex })),
      )
    : (buckets[safeActiveDay]?.activities ?? []).map((a) => ({
        activity: a,
        dayIndex: safeActiveDay,
      }));

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-md flex-wrap">
        <div
          className="flex gap-xs overflow-x-auto"
          role="tablist"
          aria-label="Itinerary day"
        >
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
                className={`whitespace-nowrap font-body-md text-sm px-sm py-xs rounded-full border transition-colors ${
                  selected
                    ? 'bg-primary text-on-primary border-primary'
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

      <div className="flex flex-col min-h-[400px] rounded-xl overflow-hidden border border-outline-variant/30 shadow-sm">
        <MapContainer
          center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
          zoom={8}
          scrollWheelZoom
          style={{ flex: 1, width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {activitiesToShow.map(({ activity, dayIndex }, idx) => {
            const coords = activity.snapshot?.location?.coords;
            if (!coords) return null;
            const color = showAll ? colorForDay(dayIndex) : '#0ea5e9';
            const label = showAll ? String(dayIndex + 1) : String(idx + 1);
            return (
              <Marker
                key={activity.id}
                position={[coords.lat, coords.lng]}
                icon={pinIcon(color, label)}
              >
                <Popup>
                  <div className="space-y-xs min-w-[180px]">
                    <div className="font-bold">{activity.snapshot?.name}</div>
                    <div className="text-on-surface-variant text-sm">
                      {dayLabel(trip, dayIndex)} ·{' '}
                      {activity.start_time
                        ? formatHHMM(activity.start_time)
                        : 'unscheduled'}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {showAll && (
        <div className="flex gap-md flex-wrap text-xs text-on-surface-variant">
          {buckets.map((b) => (
            <span key={b.dayIndex} className="flex items-center gap-xs">
              <span
                aria-hidden="true"
                style={{ background: colorForDay(b.dayIndex) }}
                className="w-3 h-3 rounded-full inline-block"
              />
              {dayLabel(trip, b.dayIndex)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
