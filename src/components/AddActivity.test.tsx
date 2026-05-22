import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Activity } from '../data/types';

// react-leaflet imports browser-only Leaflet code that doesn't render under
// jsdom. Stub the bits the LocationPicker uses with inert React nodes so the
// review step can mount without booting a real map.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: () => null,
  useMap: () => ({
    getCenter: () => ({ lat: 0, lng: 0 }),
    setView: () => undefined,
    getZoom: () => 11,
  }),
  useMapEvents: () => undefined,
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
}));

const ownerState = vi.hoisted(() => ({ isOwner: true }));
vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({
    isOwner: ownerState.isOwner,
    isLoaded: true,
    email: 'owner@example.com',
  }),
}));

const saveSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/userActivities', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/userActivities')>(
      '../lib/userActivities',
    );
  return { ...actual, saveUserActivity: saveSpy };
});

import { AddActivity } from './AddActivity';

const baseActivity: Activity = {
  id: 'test-edit-activity',
  name: 'Original Name',
  shortDescription: 'Original short description.',
  longDescription: 'Original long description.',
  category: 'hiking',
  region: 'north-bay',
  location: {
    city: 'Mill Valley, CA',
    coords: { lat: 37.8917, lng: -122.5719 },
  },
  duration: 'Half Day',
  difficulty: 'moderate',
  dogFriendly: false,
  coverImage: 'https://example.com/orig.jpg',
  notes: 'Original completion note.',
  completed: true,
  completedDate: '2025-10-12',
  hikeDistanceMiles: 4.2,
  hikeElevationFeet: 850,
  allTrailsUrl: 'https://www.alltrails.com/trail/test',
  allTrailsRating: 4.5,
};

beforeEach(() => {
  ownerState.isOwner = true;
  saveSpy.mockClear();
});

describe('AddActivity — edit mode', () => {
  it('opens straight to the review step with the "Edit activity" header', () => {
    render(
      <AddActivity onClose={() => {}} editActivity={baseActivity} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Edit activity' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Generate/ }),
    ).not.toBeInTheDocument();
  });

  it('seeds every editable field from the activity', () => {
    render(
      <AddActivity onClose={() => {}} editActivity={baseActivity} />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Original Name');
    expect(screen.getByLabelText('Short description')).toHaveValue(
      'Original short description.',
    );
    expect(screen.getByLabelText('Long description')).toHaveValue(
      'Original long description.',
    );
    expect(screen.getByLabelText('Cover image URL')).toHaveValue(
      'https://example.com/orig.jpg',
    );
    expect(screen.getByLabelText('Category')).toHaveValue('hiking');
    expect(screen.getByLabelText('City')).toHaveValue('Mill Valley, CA');
    expect(screen.getByLabelText('AllTrails URL')).toHaveValue(
      'https://www.alltrails.com/trail/test',
    );
    expect(screen.getByLabelText('AllTrails rating')).toHaveValue(4.5);
    expect(screen.getByLabelText('Distance (mi)')).toHaveValue(4.2);
    expect(screen.getByLabelText('Elevation gain (ft)')).toHaveValue(850);
  });

  it('round-trips edits to trail-detail fields through Save', async () => {
    const onClose = vi.fn();
    render(<AddActivity onClose={onClose} editActivity={baseActivity} />);

    const url = screen.getByLabelText('AllTrails URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://www.alltrails.com/trail/new');

    const rating = screen.getByLabelText('AllTrails rating');
    await userEvent.clear(rating);
    await userEvent.type(rating, '4.8');

    const distance = screen.getByLabelText('Distance (mi)');
    await userEvent.clear(distance);
    await userEvent.type(distance, '5.6');

    const elev = screen.getByLabelText('Elevation gain (ft)');
    await userEvent.clear(elev);
    await userEvent.type(elev, '1200');

    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const call = saveSpy.mock.calls[0] as [Activity, string | null];
    expect(call[0]).toMatchObject({
      id: 'test-edit-activity',
      allTrailsUrl: 'https://www.alltrails.com/trail/new',
      allTrailsRating: 4.8,
      hikeDistanceMiles: 5.6,
      hikeElevationFeet: 1200,
    });
  });

  it('clears optional trail fields back to undefined when emptied', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);

    await userEvent.clear(screen.getByLabelText('AllTrails URL'));
    await userEvent.clear(screen.getByLabelText('AllTrails rating'));
    await userEvent.clear(screen.getByLabelText('Distance (mi)'));
    await userEvent.clear(screen.getByLabelText('Elevation gain (ft)'));

    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const saved = (saveSpy.mock.calls[0] as [Activity, string | null])[0];
    expect(saved.allTrailsUrl).toBeUndefined();
    expect(saved.allTrailsRating).toBeUndefined();
    expect(saved.hikeDistanceMiles).toBeUndefined();
    expect(saved.hikeElevationFeet).toBeUndefined();
  });

  it('hides the Notes field in edit mode (owned by the completion log)', () => {
    render(
      <AddActivity onClose={() => {}} editActivity={baseActivity} />,
    );
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('shows a Cancel button (not Back) that closes without saving', async () => {
    const onClose = vi.fn();
    render(<AddActivity onClose={onClose} editActivity={baseActivity} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('upserts against the same id with edited fields, preserving id / completed / notes / unknown fields', async () => {
    // Sneak an unknown field onto the activity to verify it round-trips —
    // future schema additions (contributors, addedBy, …) should not be
    // stripped by the edit flow.
    const withExtras = {
      ...baseActivity,
      addedBy: 'someone@example.com',
    } as Activity & { addedBy: string };

    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <AddActivity
        onClose={onClose}
        editActivity={withExtras}
        onSaved={onSaved}
      />,
    );

    const nameInput = screen.getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Edited Name');
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    const call = saveSpy.mock.calls[0] as [Activity & { addedBy?: string }, string | null];
    const savedActivity = call[0];
    expect(call[1]).toBeNull();
    expect(savedActivity).toMatchObject({
      id: 'test-edit-activity',
      name: 'Edited Name',
      shortDescription: 'Original short description.',
      completed: true,
      completedDate: '2025-10-12',
      notes: 'Original completion note.',
      hikeDistanceMiles: 4.2,
      hikeElevationFeet: 850,
      allTrailsUrl: 'https://www.alltrails.com/trail/test',
      allTrailsRating: 4.5,
      addedBy: 'someone@example.com',
    });
    expect(onSaved).toHaveBeenCalledWith(savedActivity);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
