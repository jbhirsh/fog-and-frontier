import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
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

// Suggestions from signed-in non-owners (#73).
const suggestSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/suggestions', () => ({ suggestUserActivity: suggestSpy }));

const lookupSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/alltrails', () => ({
  lookupAllTrails: lookupSpy,
}));

// The accounts the review step can credit (#9).
const usersSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/userTrips', () => ({ fetchUsers: usersSpy }));

// Look-alikes in the catalog (#17); freshId stays real.
const dupSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/duplicates', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/duplicates')>('../lib/duplicates');
  return { ...actual, checkDuplicates: dupSpy };
});

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
  usersSpy.mockReset();
  dupSpy.mockReset();
  dupSpy.mockResolvedValue([]);
  suggestSpy.mockReset();
  suggestSpy.mockResolvedValue('s1');
  usersSpy.mockResolvedValue([
    { email: 'owner@example.com', display_name: null },
    { email: 'tarun@example.com', display_name: null },
  ]);
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

  it('names the review form\'s options in words, not slugs or CSS capitals', () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const options = (label: string | RegExp) =>
      [...screen.getByLabelText<HTMLSelectElement>(label).options].map((o) => o.textContent);
    expect(options('Category')).toEqual([
      'Hiking', 'Cycling', 'Water', 'Food', 'Culture', 'Scenic', 'Climbing', 'Camping', 'Other',
    ]);
    expect(options('Region')).toEqual([
      'San Francisco', 'North Bay', 'East Bay', 'South Bay', 'Peninsula',
      'Central Coast', 'NorCal', 'SoCal', 'Oregon', 'Washington',
    ]);
    expect(options('Difficulty')).toEqual(['—', 'Easy', 'Moderate', 'Advanced']);
    expect(options(/^Park type/)).toEqual([
      '— Not in a park —', 'National', 'State', 'Regional', 'County', 'City', 'Private',
    ]);
    // Nothing is left to CSS capitalize, which capitalises every word.
    for (const label of ['Category', 'Region', 'Difficulty', /^Park type/]) {
      expect(screen.getByLabelText(label)).not.toHaveClass('capitalize');
    }
  });

  it('draws every select in the review form like the inputs, with the pills\' caret', () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const selects = screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT');
    expect(selects.map((el) => el.closest('label')?.firstChild?.textContent)).toEqual([
      'Category', 'Region', 'Duration', 'Difficulty', 'Park type (optional)', 'Dog friendly', 'Cost per person',
    ]);
    for (const select of selects) {
      expect(select).toHaveClass('appearance-none', 'select-caret');
    }
  });

  it('draws the edge buttons\' focus rings inside, where the panel can\'t clip them', () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    for (const name of ['Cancel', 'Close']) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'focus-visible:ring-2',
        'focus-visible:ring-inset',
      );
    }
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('-ml-md');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('-mr-[14.5px]');
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

describe('AddActivity — contributors (#9)', () => {
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

  async function saved() {
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    return (saveSpy.mock.calls[0] as [Activity])[0];
  }

  it('loads the accounts only once it reaches the review step', async () => {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />);
    expect(usersSpy).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('combobox', { name: 'Add contributor' });
    expect(usersSpy).toHaveBeenCalledTimes(1);
  });

  it('credits whoever adds it, and lets them add the others from the accounts', async () => {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    const picker = await screen.findByRole('combobox', { name: 'Add contributor' });
    expect(screen.getByRole('group', { name: 'Contributors' })).toHaveTextContent('Owner');
    expect(
      [...picker.querySelectorAll('option')].map((o) => o.textContent),
    ).toEqual(['+ Add contributor', 'Tarun']);
    await userEvent.selectOptions(picker, 'tarun@example.com');
    expect((await saved()).contributors).toEqual(['owner@example.com', 'tarun@example.com']);
  });

  it('keeps an edited activity\'s contributors as they were', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{ ...baseActivity, contributors: ['tarun@example.com'] }}
      />,
    );
    // The only contributor can't be removed.
    expect(screen.queryByRole('button', { name: 'Remove Tarun' })).not.toBeInTheDocument();
    expect((await saved()).contributors).toEqual(['tarun@example.com']);
  });

  it('leaves an uncredited activity uncredited unless someone is picked', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    expect(await screen.findByRole('combobox', { name: 'Add contributor' })).toBeInTheDocument();
    expect((await saved()).contributors).toBeUndefined();
  });

  it('still saves when the accounts cannot be loaded', async () => {
    usersSpy.mockRejectedValue(new Error('offline'));
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{ ...baseActivity, contributors: ['tarun@example.com'] }}
      />,
    );
    await waitFor(() => expect(usersSpy).toHaveBeenCalled());
    expect(screen.queryByRole('combobox', { name: 'Add contributor' })).not.toBeInTheDocument();
    expect((await saved()).contributors).toEqual(['tarun@example.com']);
  });
});

describe('AddActivity — cost (#85)', () => {
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

  async function saved() {
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    return (saveSpy.mock.calls[0] as [Activity])[0];
  }

  it("carries Gemini's estimate into the draft", async () => {
    generateSpy.mockResolvedValue({ ...generated, costTier: 'free' });
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(await screen.findByLabelText('Cost per person')).toHaveValue('free');
    expect((await saved()).costTier).toBe('free');
  });

  it('offers each tier with its range, and can set or clear it', async () => {
    render(<AddActivity onClose={() => {}} editActivity={{ ...baseActivity, costTier: '$' }} />);
    const cost = screen.getByLabelText('Cost per person');
    expect([...cost.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '—',
      'Free',
      '$ · under $25',
      '$$ · $25–75',
      '$$$ · over $75',
    ]);
    await userEvent.selectOptions(cost, '$$$');
    await userEvent.selectOptions(cost, '');
    expect((await saved()).costTier).toBeUndefined();
  });

  it('saves a tier picked by hand', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    await userEvent.selectOptions(screen.getByLabelText('Cost per person'), '$$');
    expect((await saved()).costTier).toBe('$$');
  });
});

describe('AddActivity — duplicates (#17)', () => {
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
  const match = (confidence: 'high' | 'possible', id = 'castle-rock') => ({
    id,
    name: 'Castle Rock',
    city: 'Los Gatos',
    distanceMeters: 30,
    confidence,
  });
  type SaveCall = [Activity, { create?: boolean; allowDuplicate?: boolean } | undefined];

  async function review(props: Partial<Parameters<typeof AddActivity>[0]> = {}) {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} {...props} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: /Save activity/ });
  }
  const saveButton = () => screen.getByRole('button', { name: /Save activity/ });

  it('warns as the review opens, and the plain Save holds and says why', async () => {
    dupSpy.mockResolvedValue([match('high')]);
    await review();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This looks like a duplicate of Castle Rock in Los Gatos.',
    );
    await userEvent.click(saveButton());
    expect(
      await screen.findByText(
        "This looks like one already saved. Open it, or choose Save anyway if it's a different place.",
      ),
    ).toBeInTheDocument();
    expect(dupSpy).toHaveBeenCalledTimes(2); // re-checked on save
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('saves anyway as a new activity, and hands back the id the server used', async () => {
    dupSpy.mockResolvedValue([match('high')]);
    saveSpy.mockResolvedValueOnce('castle-rock-2');
    const onSaved = vi.fn();
    await review({ onSaved });
    await userEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const [saved, options] = saveSpy.mock.calls[0] as SaveCall;
    expect(saved.id).toBe('castle-rock');
    expect(options).toEqual({ create: true, allowDuplicate: true });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'castle-rock-2' }));
  });

  it('after a rename, saves under the new name as a create, never over the look-alike', async () => {
    dupSpy.mockResolvedValueOnce([match('high')]).mockResolvedValue([]);
    await review();
    await screen.findByRole('alert');
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Castle Rock Goat Rock Trailhead');
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const [saved, options] = saveSpy.mock.calls[0] as SaveCall;
    expect(saved.id).toBe('castle-rock-goat-rock-trailhead');
    expect(options).toEqual({ create: true, allowDuplicate: false });
  });

  it('re-checks a moment after the name changes, so the warning follows the draft', async () => {
    dupSpy.mockResolvedValueOnce([match('high')]).mockResolvedValue([]);
    await review();
    await screen.findByRole('alert');
    await userEvent.type(screen.getByLabelText('Name'), ' Trailhead');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(dupSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Castle Rock Trailhead' }),
    );
  });

  it("holds a Save anyway when a match turns up that wasn't on screen", async () => {
    dupSpy
      .mockResolvedValueOnce([match('high')])
      .mockResolvedValue([match('high'), match('high', 'castle-rock-ii')]);
    await review();
    await userEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));
    expect(
      await screen.findByText('Another saved activity looks like this one too. Check it before saving.'),
    ).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('opens the saved one instead', async () => {
    dupSpy.mockResolvedValue([match('high')]);
    const onOpenActivity = vi.fn();
    await review({ onOpenActivity });
    await userEvent.click(await screen.findByRole('button', { name: 'Open existing' }));
    expect(onOpenActivity).toHaveBeenCalledWith('castle-rock');
  });

  it('lets a possible match through as a plain create', async () => {
    dupSpy.mockResolvedValue([match('possible')]);
    await review();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You may already have Castle Rock in Los Gatos saved.',
    );
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as SaveCall)[1]).toEqual({ create: true, allowDuplicate: false });
  });

  it('saves when the check itself fails (the server still refuses a real duplicate)', async () => {
    dupSpy.mockRejectedValue(new Error('offline'));
    await review();
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it("shows the look-alike when the server refuses one the check didn't see", async () => {
    dupSpy.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([match('high')]);
    saveSpy.mockRejectedValueOnce(
      new CombinedGraphQLErrors({
        errors: [
          {
            message: 'looks like a duplicate of Castle Rock',
            extensions: { code: 'CONFLICT', appCode: 'duplicate' },
          },
        ],
      }),
    );
    await review();
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('This looks like a duplicate of Castle Rock');
    expect(screen.getByText('looks like a duplicate of Castle Rock')).toBeInTheDocument();
  });

  it('drops the warning on going back to the form', async () => {
    dupSpy.mockResolvedValue([match('high')]);
    await review();
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never checks an edit, which saves its own id', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(dupSpy).not.toHaveBeenCalled();
    const [saved, options] = saveSpy.mock.calls[0] as SaveCall;
    expect(saved.id).toBe(baseActivity.id);
    expect(options).toBeUndefined();
  });
});

describe('AddActivity — suggest mode (#73)', () => {
  it("leaves an owner's title and notes unbounded", () => {
    render(<AddActivity onClose={() => {}} />);
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('maxlength');
    expect(screen.getByLabelText('Notes / links (optional)')).not.toHaveAttribute('maxlength');
  });

  const generated: GeneratedFields = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    category: 'hiking',
    region: 'south-bay',
    city: 'Los Gatos',
    lat: 37.23,
    lng: -122.1,
    duration: 'Half Day',
    allTrailsUrl: 'https://www.alltrails.com/trail/castle-rock',
  };

  async function review(onClose = vi.fn()) {
    ownerState.isOwner = false;
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={onClose} suggest />);
    expect(screen.getByRole('dialog', { name: 'Suggest activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Suggest activity' })).toBeInTheDocument();
    expect(screen.getByText(/up to five links.*up to five a day/)).toBeInTheDocument();
    // The server's bounds on a suggestion's draft.
    expect(screen.getByLabelText('Title')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Notes / links (optional)')).toHaveAttribute('maxlength', '2000');
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: 'Send suggestion' });
  }

  it('reviews without crediting or the AllTrails refresh note', async () => {
    await review();
    expect(screen.getByRole('heading', { name: 'Review & send' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Contributors' })).not.toBeInTheDocument();
    expect(screen.queryByText(/refreshed from\s+AllTrails/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save activity/ })).not.toBeInTheDocument();
    expect(usersSpy).not.toHaveBeenCalled();
  });

  it('sends it for review instead of saving, and says so', async () => {
    const onClose = vi.fn();
    await review(onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    const done = await screen.findByRole('button', { name: 'Done' });
    expect(suggestSpy).toHaveBeenCalledTimes(1);
    const [sent, options] = suggestSpy.mock.calls[0] as [Activity, { allowDuplicate: boolean }];
    expect(sent).toMatchObject({ name: 'Castle Rock', contributors: undefined });
    expect(options).toEqual({ allowDuplicate: false });
    // No owner-only calls: no save, no AllTrails lookup.
    expect(saveSpy).not.toHaveBeenCalled();
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Suggestion sent' })).toBeInTheDocument();
    // The envelope's ink is centred, not its box (its glyph sits right of centre).
    const envelope = screen.getByText('mark_email_read');
    expect(envelope.style).toMatchObject({ fontSize: '48px', transform: 'translateX(-0.028em)' });
    expect(done).toHaveFocus();
    expect(done).toHaveAccessibleDescription(
      'Sent to the owners for review. If they add it, it joins the catalog with you credited for it.',
    );
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('holds a high look-alike, then sends anyway', async () => {
    dupSpy.mockResolvedValue([
      { id: 'castle-rock', name: 'Castle Rock', city: 'Los Gatos', distanceMeters: 30, confidence: 'high' },
    ]);
    await review();
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(
      await screen.findByText(
        "This looks like one already saved. Open it, or choose Send anyway if it's a different place.",
      ),
    ).toBeInTheDocument();
    expect(suggestSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    await waitFor(() => expect(suggestSpy).toHaveBeenCalledTimes(1));
    expect(suggestSpy.mock.calls[0][1]).toEqual({ allowDuplicate: true });
  });

  it('shows why sending failed, and lets them try again', async () => {
    suggestSpy.mockRejectedValueOnce(new Error('Network down'));
    await review();
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeEnabled();
  });

  it("says when today's drafts are used up", async () => {
    ownerState.isOwner = false;
    generateSpy.mockRejectedValue(new Error("You've used today's AI drafts. Try again tomorrow."));
    render(<AddActivity onClose={() => {}} suggest />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(
      await screen.findByText("You've used today's AI drafts. Try again tomorrow."),
    ).toBeInTheDocument();
  });
});
