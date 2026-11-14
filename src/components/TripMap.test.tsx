import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Trip, TripActivity } from '../lib/userTrips';
import { CARTO_TILE_URL } from '../lib/mapPins';
import { WORLD_BOUNDS } from '../lib/mapFit';
import { makeTrip, tripActivity } from '../test/trips';
import { fake, iconHtml, markerProps } from '../test/fakeMap';
import { TripMap } from './TripMap';

vi.mock('react-leaflet', () => import('../test/fakeReactLeaflet'));

beforeEach(() => {
  fake.reset();
});

function stop(
  id: string,
  day_index: number | null,
  start_time: string | null,
  coords = { lat: 37.9, lng: -122.6 },
): TripActivity {
  const base = tripActivity(id, { day_index, start_time });
  return { ...base, snapshot: { ...base.snapshot!, location: { city: 'Here', coords } } };
}

// Three days: Fri 7 – Sun 9 Aug 2026.
function trip(activities: TripActivity[]): Trip {
  return makeTrip({ start_date: '2026-08-07', end_date: '2026-08-09', activities });
}

const markers = () => screen.queryAllByTestId('marker');

describe('TripMap', () => {
  it('pins each timed place on one of the trip’s days, numbered and labelled by its day', () => {
    render(
      <TripMap
        trip={trip([
          stop('a', 0, '09:30', { lat: 37.1, lng: -122.1 }),
          stop('b', 2, '14:05', { lat: 37.2, lng: -122.2 }),
        ])}
      />,
    );
    const [a, b] = markers();
    expect(markers()).toHaveLength(2);
    expect(markerProps(a).position).toEqual([37.1, -122.1]);
    expect(markerProps(b).position).toEqual([37.2, -122.2]);
    expect(within(a).getByTestId('marker-icon')).toHaveTextContent(/^1$/);
    expect(within(b).getByTestId('marker-icon')).toHaveTextContent(/^3$/);
    expect(within(a).getByTestId('popup')).toHaveTextContent('Place aDay 1 · Fri, Aug 7 · 9:30 AM');
    expect(within(b).getByTestId('popup')).toHaveTextContent('Place bDay 3 · Sun, Aug 9 · 2:05 PM');
  });

  it('colours each day’s pins, cycling past eight days', () => {
    const days = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const long = { ...trip(days.map((d) => stop(`d${d}`, d, '10:00'))), end_date: '2026-08-15' };
    render(<TripMap trip={long} />);
    const colours = markers().map((m) => {
      const html = iconHtml(markerProps(m).icon);
      return /background:\s*(#[0-9a-f]{6})/.exec(html)?.[1];
    });
    expect(colours).toEqual([
      '#0ea5e9',
      '#f97316',
      '#16a34a',
      '#a855f7',
      '#dc2626',
      '#0891b2',
      '#ca8a04',
      '#db2777',
      '#0ea5e9',
    ]);
  });

  it('leaves off places with no day, no time, a day past the trip’s end, or no place', () => {
    render(
      <TripMap
        trip={trip([
          stop('unassigned', null, '09:00'),
          stop('untimed', 0, null),
          stop('past-end', 3, '09:00'),
          { ...stop('deleted', 0, '09:00'), snapshot: null },
          stop('last-day', 2, '09:00'),
        ])}
      />,
    );
    expect(markers()).toHaveLength(1);
    expect(screen.getByText('Place last-day')).toBeInTheDocument();
  });

  it('redraws for a changed trip', () => {
    const { rerender } = render(<TripMap trip={trip([stop('a', 0, '09:00')])} />);
    rerender(<TripMap trip={trip([stop('a', 0, '09:00'), stop('b', 1, '10:00')])} />);
    expect(markers()).toHaveLength(2);
  });

  it('is a world map of CARTO tiles, opening on home, with its own zoom and credit', () => {
    render(<TripMap trip={trip([])} />);
    expect(fake.containerProps).toMatchObject({
      center: [37.3382, -121.8863],
      zoom: 8,
      worldCopyJump: true,
      maxBounds: WORLD_BOUNDS,
      maxBoundsViscosity: 1,
      scrollWheelZoom: true,
      zoomControl: false,
      attributionControl: false,
      style: { flex: 1, width: '100%' },
    });
    expect(fake.tileUrl).toBe(CARTO_TILE_URL);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Map credits' })).toBeInTheDocument();
    expect(markers()).toHaveLength(0);
  });
});
