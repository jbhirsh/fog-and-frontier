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

const lookupSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/alltrails', () => ({
  lookupAllTrails: lookupSpy,
}));

const generateSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/generateActivity', () => ({
  generateActivity: generateSpy,
}));

import type { GeneratedFields } from '../lib/generateActivity';
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
  lookupSpy.mockReset();
  generateSpy.mockReset();
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

  it('seeds the editable fields from the activity', () => {
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
  });

  it('does not expose AllTrails rating / distance / elevation as inputs', () => {
    render(
      <AddActivity onClose={() => {}} editActivity={baseActivity} />,
    );
    expect(screen.queryByLabelText('AllTrails rating')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Distance (mi)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Elevation gain/)).not.toBeInTheDocument();
  });

  it('skips the AllTrails lookup when the URL is unchanged on save', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Edited Name');

    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(lookupSpy).not.toHaveBeenCalled();
    const saved = (saveSpy.mock.calls[0] as [Activity, string | null])[0];
    expect(saved).toMatchObject({
      allTrailsUrl: baseActivity.allTrailsUrl,
      allTrailsRating: baseActivity.allTrailsRating,
      hikeDistanceMiles: baseActivity.hikeDistanceMiles,
      hikeElevationFeet: baseActivity.hikeElevationFeet,
    });
  });

  it('refreshes rating / distance / elevation from AllTrails when the URL changes', async () => {
    lookupSpy.mockResolvedValue({
      allTrailsRating: 4.9,
      hikeDistanceMiles: 6.1,
      hikeElevationFeet: 1450,
    });

    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const url = screen.getByLabelText('AllTrails URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://www.alltrails.com/trail/new');

    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(lookupSpy).toHaveBeenCalledWith(
      'https://www.alltrails.com/trail/new',
    );
    const saved = (saveSpy.mock.calls[0] as [Activity])[0];
    expect(saved).toMatchObject({
      allTrailsUrl: 'https://www.alltrails.com/trail/new',
      allTrailsRating: 4.9,
      hikeDistanceMiles: 6.1,
      hikeElevationFeet: 1450,
    });
  });

  it('clears derived trail fields when the AllTrails URL is removed', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    await userEvent.clear(screen.getByLabelText('AllTrails URL'));

    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(lookupSpy).not.toHaveBeenCalled();
    const saved = (saveSpy.mock.calls[0] as [Activity, string | null])[0];
    expect(saved.allTrailsUrl).toBeUndefined();
    expect(saved.allTrailsRating).toBeUndefined();
    expect(saved.hikeDistanceMiles).toBeUndefined();
    expect(saved.hikeElevationFeet).toBeUndefined();
  });

  it('blocks save and surfaces an error when the AllTrails lookup fails', async () => {
    lookupSpy.mockRejectedValue(new Error('lookup failed'));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <AddActivity
        onClose={onClose}
        editActivity={baseActivity}
        onSaved={onSaved}
      />,
    );
    const url = screen.getByLabelText('AllTrails URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://www.alltrails.com/trail/broken');

    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));

    await waitFor(() => {
      expect(screen.getByText(/lookup failed/i)).toBeInTheDocument();
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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
    const call = saveSpy.mock.calls[0] as [Activity & { addedBy?: string }];
    const savedActivity = call[0];
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

describe('AddActivity — cover credit (#36)', () => {
  const credit = 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons';
  const generated: GeneratedFields = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    category: 'hiking',
    region: 'south-bay',
    city: 'Los Gatos',
    lat: 37.23,
    lng: -122.1,
    duration: 'Half Day',
  };

  async function generateAndSave() {
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    return (saveSpy.mock.calls[0] as [Activity])[0];
  }

  it('keeps the looked-up cover and its credit', async () => {
    generateSpy.mockResolvedValue({
      ...generated,
      coverImage: 'https://upload.wikimedia.org/castle.jpg',
      coverCredit: credit,
    });
    const saved = await generateAndSave();
    expect(saved.coverImage).toBe('https://upload.wikimedia.org/castle.jpg');
    expect(saved.coverCredit).toBe(credit);
  });

  it('leaves the cover empty, not a stock photo, when nothing matched', async () => {
    generateSpy.mockResolvedValue(generated);
    const saved = await generateAndSave();
    expect(saved.coverImage).toBe('');
    expect(saved.coverCredit).toBeUndefined();
  });

  it('keeps the credit when the cover URL is untouched', async () => {
    render(
      <AddActivity onClose={() => {}} editActivity={{ ...baseActivity, coverCredit: credit }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].coverCredit).toBe(credit);
  });

  it('drops the credit when the owner pastes a different cover URL', async () => {
    render(
      <AddActivity onClose={() => {}} editActivity={{ ...baseActivity, coverCredit: credit }} />,
    );
    const cover = screen.getByLabelText('Cover image URL');
    await userEvent.clear(cover);
    await userEvent.type(cover, 'https://example.com/mine.jpg');
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const saved = (saveSpy.mock.calls[0] as [Activity])[0];
    expect(saved.coverImage).toBe('https://example.com/mine.jpg');
    expect(saved.coverCredit).toBeUndefined();
  });
});
