import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../test/render';
import userEvent from '@testing-library/user-event';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { Activity } from '../data/types';
import { deferred } from '../test/deferred';

// react-leaflet imports browser-only Leaflet code that doesn't render under
// jsdom. Stub the bits the LocationPicker uses with inert React nodes so the
// review step can mount without booting a real map. The map's click handler
// and the pin's dragend are kept, so a test can tap the map or drag the pin;
// the map shows where it was opened, and the pin where it is and its icon.
const mapEvents = vi.hoisted(() => ({
  click: undefined as undefined | ((e: { latlng: { lat: number; lng: number } }) => void),
  dragend: undefined as undefined | (() => void),
}));
// The one map the picker is handed: where it looks (as if panned there), its
// zoom, each setView, and where the next drag of the pin ends.
const mapView = vi.hoisted(() => ({
  center: { lat: 0, lng: 0 },
  zoom: 11,
  setView: vi.fn(),
  dragTo: { lat: 0, lng: 0 },
}));
vi.mock('react-leaflet', async () => {
  const { useImperativeHandle } = await import('react');
  const map = {
    getCenter: () => mapView.center,
    setView: mapView.setView,
    getZoom: () => mapView.zoom,
  };
  return {
    MapContainer: ({
      children,
      center,
      zoom,
      style,
    }: {
      children?: React.ReactNode;
      center: [number, number];
      zoom: number;
      style?: React.CSSProperties;
    }) => (
      <div data-testid="map-container" data-center={center.join()} data-zoom={zoom} style={style}>
        {children}
      </div>
    ),
    TileLayer: () => null,
    Marker: ({
      ref,
      position,
      icon,
      eventHandlers,
    }: {
      ref?: React.Ref<unknown>;
      position: [number, number];
      icon: { iconSize?: number[]; iconAnchor?: number[] };
      eventHandlers?: { dragend?: () => void };
    }) => {
      useImperativeHandle(ref, () => ({ getLatLng: () => mapView.dragTo }));
      mapEvents.dragend = eventHandlers?.dragend;
      return (
        <div
          data-testid="map-pin"
          data-position={position.join()}
          data-icon-size={icon.iconSize?.join()}
          data-icon-anchor={icon.iconAnchor?.join()}
        />
      );
    },
    useMap: () => map,
    useMapEvents: (handlers: typeof mapEvents) => {
      mapEvents.click = handlers.click;
      return undefined;
    },
  };
});

// An icon is the options it was made with.
vi.mock('leaflet', () => ({
  divIcon: (options: object) => options,
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
    await vi.importActual<typeof import('../lib/userActivities')>('../lib/userActivities');
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
  const actual = await vi.importActual<typeof import('../lib/duplicates')>('../lib/duplicates');
  return { ...actual, checkDuplicates: dupSpy };
});

const generateSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/generateActivity', () => ({
  generateActivity: generateSpy,
}));

import type { GeneratedFields } from '../lib/generateActivity';
import { AddActivity } from './AddActivity';
import { getIcon } from '../test/icons';

// The region list scrolls its option into view (#274), which jsdom doesn't do.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const baseActivity: Activity = {
  id: 'test-edit-activity',
  name: 'Original Name',
  shortDescription: 'Original short description.',
  cardLine: 'A line that fits on a card.',
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

// Taps the map, as a friend dropping a pin would.
function dropPin(lat: number, lng: number) {
  act(() => mapEvents.click?.({ latlng: { lat, lng } }));
}

// Makes a change to the review, then lets every timer it left run, as the
// look-alike re-check's wait.
async function afterTimers(change: () => void) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    change();
    await act(() => vi.runOnlyPendingTimersAsync());
  } finally {
    vi.useRealTimers();
  }
}

// Lets a held answer come back, and what waited on it run.
async function settle<T>(held: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    held.resolve(value);
    await held.promise;
  });
}

beforeEach(() => {
  mapView.center = { lat: 0, lng: 0 };
  mapView.zoom = 11;
  mapView.setView.mockClear();
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
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    expect(screen.getByRole('heading', { name: 'Edit activity' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument();
    // Nothing searched or checked: no other trails, no look-alike.
    expect(
      screen.queryByRole('button', { name: /Not the right trail|Pick from/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('seeds the editable fields from the activity', () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Original Name');
    expect(screen.getByLabelText('Short description')).toHaveValue('Original short description.');
    expect(screen.getByLabelText('Long description')).toHaveValue('Original long description.');
    expect(screen.getByLabelText('Cover image URL')).toHaveValue('https://example.com/orig.jpg');
    expect(screen.getByLabelText('Category')).toHaveValue('hiking');
    expect(screen.getByLabelText('Difficulty')).toHaveValue('moderate');
    expect(screen.getByLabelText('City')).toHaveValue('Mill Valley, CA');
    expect(screen.getByLabelText('AllTrails URL')).toHaveValue(
      'https://www.alltrails.com/trail/test',
    );
  });

  it('shows all of the short description, kept to one paragraph', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const field = screen.getByLabelText('Short description');
    // Wrapped and as tall as its text, not cut off on one line.
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveClass('field-sizing-content');
    expect(field).toHaveAttribute('rows', '2');
    await userEvent.clear(field);
    await userEvent.type(field, 'Food trucks{Enter}and music');
    expect(field).toHaveValue('Food trucks and music');
    // A pasted break, and the space around it, is one space.
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste('Food trucks \n\n live music');
    expect(field).toHaveValue('Food trucks live music');
  });

  it('does not expose AllTrails rating / distance / elevation as inputs', () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    expect(screen.queryByLabelText('AllTrails rating')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Distance (mi)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Elevation gain/)).not.toBeInTheDocument();
  });

  it("names the review form's options in words, not slugs or CSS capitals", () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const options = (label: string | RegExp) =>
      [...screen.getByLabelText<HTMLSelectElement>(label).options].map((o) => o.textContent);
    expect(options('Category')).toEqual([
      'Hiking',
      'Cycling',
      'Water',
      'Food',
      'Culture',
      'Scenic',
      'Climbing',
      'Camping',
      'Other',
    ]);
    // Region is a search over every region (#274), showing the one chosen.
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveValue('North Bay');
    expect(options('Difficulty')).toEqual(['—', 'Easy', 'Moderate', 'Advanced']);
    expect(options(/^Park type/)).toEqual([
      '— Not in a park —',
      'National',
      'State',
      'Regional',
      'County',
      'City',
      'Private',
    ]);
    // Nothing is left to CSS capitalize, which capitalises every word.
    for (const label of ['Category', 'Region', 'Difficulty', /^Park type/]) {
      expect(screen.getByLabelText(label)).not.toHaveClass('capitalize');
    }
  });

  it("draws every select in the review form like the inputs, with the pills' caret", () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const selects = screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT');
    expect(selects.map((el) => el.closest('label')?.firstChild?.textContent)).toEqual([
      'Category',
      'Duration',
      'Difficulty',
      'Park type (optional)',
      'Part of (optional)',
      'Dog friendly',
      'Cost per person',
    ]);
    for (const select of selects) {
      expect(select).toHaveClass('appearance-none', 'select-caret');
    }
  });

  it("draws the edge buttons' focus rings inside, where the panel can't clip them", () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    for (const name of ['Cancel', 'Close']) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'focus-visible:ring-2',
        'focus-visible:ring-inset',
      );
    }
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('-ml-md');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('mr-[-14.5px]');
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

  it('doesn’t look a saved link up again for a stray space around it', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{ ...baseActivity, allTrailsUrl: `${baseActivity.allTrailsUrl} ` }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(lookupSpy).not.toHaveBeenCalled();
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
    expect(lookupSpy).toHaveBeenCalledWith('https://www.alltrails.com/trail/new');
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
    expect(saved).toMatchObject({ id: baseActivity.id, name: baseActivity.name });
    expect(saved.allTrailsUrl).toBeUndefined();
    expect(saved.allTrailsRating).toBeUndefined();
    expect(saved.hikeDistanceMiles).toBeUndefined();
    expect(saved.hikeElevationFeet).toBeUndefined();
  });

  it('blocks save and surfaces an error when the AllTrails lookup fails', async () => {
    lookupSpy.mockRejectedValue(new Error('lookup failed'));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<AddActivity onClose={onClose} editActivity={baseActivity} onSaved={onSaved} />);
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
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
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
    render(<AddActivity onClose={onClose} editActivity={withExtras} onSaved={onSaved} />);

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
      cardLine: 'A line that fits on a card.',
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

describe('AddActivity — other trails found (#6)', () => {
  const T = 'https://www.alltrails.com/trail/us/california/';
  const generated: GeneratedFields = {
    name: 'Alamere Falls',
    shortDescription: 'A tidefall',
    cardLine: 'A line that fits on a card.',
    category: 'hiking',
    region: 'north-bay',
    city: 'Bolinas',
    lat: 37.93,
    lng: -122.75,
    duration: 'Full Day',
    allTrailsUrl: `${T}alamere-falls-via-coast-trail`,
    allTrailsOptions: [
      { url: `${T}alamere-falls-via-coast-trail`, title: 'Via Coast Trail', description: '' },
      { url: `${T}wildcat-camp-trail`, title: 'Wildcat Camp Trail', description: '' },
    ],
  };

  it('offers the other trails the draft found, and saves the one chosen', async () => {
    generateSpy.mockResolvedValue(generated);
    lookupSpy.mockResolvedValue({});
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Alamere Falls');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(await screen.findByText('Via Coast Trail')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Not the right trail\? See 1 other/ }),
    );
    await userEvent.click(screen.getByText('Wildcat Camp Trail'));
    expect(screen.getByLabelText('AllTrails URL')).toHaveValue(`${T}wildcat-camp-trail`);
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].allTrailsUrl).toBe(`${T}wildcat-camp-trail`);
  });
});

describe('AddActivity — a trail’s numbers from its search (#6)', () => {
  const T = 'https://www.alltrails.com/trail/us/california/';
  const PICK = {
    url: `${T}alamere-falls`,
    title: 'Alamere Falls',
    description: '',
    rating: 4.7,
    miles: 8.4,
    feet: 1640,
  };
  const OTHER = { url: `${T}wildcat-camp`, title: 'Wildcat Camp', description: '' };
  const generated: GeneratedFields = {
    name: 'Alamere Falls',
    shortDescription: 'A tidefall',
    cardLine: 'A line that fits on a card.',
    category: 'hiking',
    region: 'north-bay',
    city: 'Bolinas',
    lat: 37.93,
    lng: -122.75,
    duration: 'Full Day',
    allTrailsUrl: PICK.url,
    hikeDistanceMiles: 9,
    hikeElevationFeet: 1500,
  };

  async function draft(g: GeneratedFields) {
    generateSpy.mockResolvedValue(g);
    lookupSpy.mockResolvedValue({
      allTrailsRating: 4.1,
      hikeDistanceMiles: 7,
      hikeElevationFeet: 900,
    });
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Alamere Falls');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: /Save activity/ });
  }
  async function saved() {
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    return (saveSpy.mock.calls[0] as [Activity])[0];
  }

  it('saves the pick’s own numbers without looking them up again', async () => {
    await draft({ ...generated, allTrailsOptions: [PICK, OTHER] });
    expect(await saved()).toMatchObject({
      allTrailsUrl: PICK.url,
      allTrailsRating: 4.7,
      hikeDistanceMiles: 8.4,
      hikeElevationFeet: 1640,
    });
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('looks them up when the pick’s page gave only some', async () => {
    await draft({ ...generated, allTrailsOptions: [{ ...PICK, feet: undefined }] });
    expect(await saved()).toMatchObject({ allTrailsRating: 4.1, hikeDistanceMiles: 7 });
    expect(lookupSpy).toHaveBeenCalledWith(PICK.url);
  });

  it('keeps Gemini’s numbers where the pick has none, for the lookup to replace', async () => {
    await draft({
      ...generated,
      allTrailsOptions: [{ ...PICK, miles: undefined, feet: undefined }],
    });
    // On the card: the rating the search had, the rest as Gemini wrote it.
    lookupSpy.mockRejectedValue(new Error('lookup down'));
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });

  it('takes another trail’s numbers when it’s chosen, and saves them as they are', async () => {
    const BEAR = {
      ...OTHER,
      url: `${T}bear-valley`,
      title: 'Bear Valley',
      rating: 4.6,
      miles: 13.4,
      feet: 2034,
    };
    await draft({ ...generated, allTrailsOptions: [PICK, BEAR] });
    await userEvent.click(screen.getByRole('button', { name: /Not the right trail/ }));
    await userEvent.click(screen.getByText('Bear Valley'));
    expect(await saved()).toMatchObject({
      allTrailsUrl: BEAR.url,
      allTrailsRating: 4.6,
      hikeDistanceMiles: 13.4,
      hikeElevationFeet: 2034,
    });
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('looks up a trail chosen without all its numbers, or one typed over it', async () => {
    await draft({ ...generated, allTrailsOptions: [PICK, OTHER] });
    await userEvent.click(screen.getByRole('button', { name: /Not the right trail/ }));
    await userEvent.click(screen.getByText('Wildcat Camp'));
    expect(await saved()).toMatchObject({ allTrailsUrl: OTHER.url, hikeDistanceMiles: 7 });
    expect(lookupSpy).toHaveBeenCalledWith(OTHER.url);
  });

  it('looks up a link typed over the pick', async () => {
    await draft({ ...generated, allTrailsOptions: [PICK] });
    const field = screen.getByLabelText('AllTrails URL');
    await userEvent.clear(field);
    await userEvent.type(field, `${T}somewhere-else`);
    expect(await saved()).toMatchObject({ hikeDistanceMiles: 7 });
    expect(lookupSpy).toHaveBeenCalledWith(`${T}somewhere-else`);
  });

  it('takes the drafted trail’s numbers, wherever the search listed it', async () => {
    const BEAR = { ...OTHER, url: `${T}bear-valley`, rating: 4.6, miles: 13.4, feet: 2034 };
    await draft({ ...generated, allTrailsOptions: [BEAR, PICK] });
    expect(await saved()).toMatchObject({
      allTrailsUrl: PICK.url,
      allTrailsRating: 4.7,
      hikeDistanceMiles: 8.4,
      hikeElevationFeet: 1640,
    });
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('looks them up when the pick’s page gave no rating', async () => {
    await draft({ ...generated, allTrailsOptions: [{ ...PICK, rating: undefined }] });
    expect(await saved()).toMatchObject({ allTrailsRating: 4.1 });
    expect(lookupSpy).toHaveBeenCalledWith(PICK.url);
  });

  it.each(['rating', 'miles', 'feet'] as const)(
    'looks up a trail chosen without its %s',
    async (missing) => {
      const BEAR = {
        ...OTHER,
        url: `${T}bear-valley`,
        title: 'Bear Valley',
        rating: 4.6,
        miles: 13.4,
        feet: 2034,
        [missing]: undefined,
      };
      await draft({ ...generated, allTrailsOptions: [PICK, BEAR] });
      await userEvent.click(screen.getByRole('button', { name: /Not the right trail/ }));
      await userEvent.click(screen.getByText('Bear Valley'));
      expect(await saved()).toMatchObject({ allTrailsUrl: BEAR.url, hikeDistanceMiles: 7 });
      expect(lookupSpy).toHaveBeenCalledWith(BEAR.url);
    },
  );

  it('looks up and saves a drafted link without the spaces around it', async () => {
    await draft({ ...generated, allTrailsUrl: ` ${PICK.url} ` });
    expect(await saved()).toMatchObject({ allTrailsUrl: PICK.url, hikeDistanceMiles: 7 });
    expect(lookupSpy).toHaveBeenCalledWith(PICK.url);
  });

  it('looks up as before when there was no search', async () => {
    await draft(generated);
    expect(screen.queryByRole('button', { name: /Not the right trail/ })).not.toBeInTheDocument();
    expect(await saved()).toMatchObject({ hikeDistanceMiles: 7, hikeElevationFeet: 900 });
    expect(lookupSpy).toHaveBeenCalledWith(PICK.url);
  });
});

describe('AddActivity — cover credit (#36)', () => {
  const credit = 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons';
  const generated: GeneratedFields = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    cardLine: 'A line that fits on a card.',
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
    cardLine: 'A line that fits on a card.',
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
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '+ Add contributor',
      'Tarun',
    ]);
    await userEvent.selectOptions(picker, 'tarun@example.com');
    expect((await saved()).contributors).toEqual(['owner@example.com', 'tarun@example.com']);
  });

  it("keeps an edited activity's contributors as they were", async () => {
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

  it('credits only whoever is picked on an uncredited activity', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const picker = await screen.findByRole('combobox', { name: 'Add contributor' });
    await userEvent.selectOptions(picker, 'tarun@example.com');
    expect((await saved()).contributors).toEqual(['tarun@example.com']);
  });

  it('drops accounts that arrive after the review that asked for them has gone', async () => {
    const late = deferred<{ email: string; display_name: null }[]>();
    usersSpy.mockReturnValueOnce(late.promise);
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    const picker = await screen.findByRole('combobox', { name: 'Add contributor' });
    await settle(late, [{ email: 'zed@example.com', display_name: null }]);
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '+ Add contributor',
      'Tarun',
    ]);
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
    cardLine: 'A line that fits on a card.',
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

describe('AddActivity — card copy (#295)', () => {
  const LONG_NAME = 'Castle Rock State Park (Saratoga Gap & Ridge Loop)';
  const generated: GeneratedFields = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    cardLine: 'Sandstone boulders, oak woods, a falls overlook.',
    category: 'hiking',
    region: 'south-bay',
    city: 'Los Gatos',
    lat: 37.23,
    lng: -122.1,
    duration: 'Half Day',
  };

  async function draft(fields: GeneratedFields) {
    generateSpy.mockResolvedValue(fields);
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByLabelText('Card line');
  }

  function save() {
    return userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
  }

  it('carries the drafted card line, and saves it', async () => {
    await draft(generated);
    expect(screen.getByLabelText('Card line')).toHaveValue(
      'Sandstone boulders, oak woods, a falls overlook.',
    );
    await save();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].cardLine).toBe(
      'Sandstone boulders, oak woods, a falls overlook.',
    );
  });

  it('asks for a card name only for a name too long for a card', async () => {
    await draft({ ...generated, name: LONG_NAME, cardName: 'Castle Rock State Park' });
    expect(screen.getByLabelText('Card name')).toHaveValue('Castle Rock State Park');
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Castle Rock');
    // Still shown while it holds one, so it can be cleared.
    expect(screen.getByLabelText('Card name')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Card name'));
    expect(screen.queryByLabelText('Card name')).not.toBeInTheDocument();
  });

  it('shows no card name for a name that fits', async () => {
    await draft(generated);
    expect(screen.queryByLabelText('Card name')).not.toBeInTheDocument();
  });

  it('won’t save a new place without a card line', async () => {
    await draft({ ...generated, cardLine: undefined });
    await save();
    expect(screen.getByText('Add a card line before saving.')).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Card line'), 'Ridge loop with bay views.');
    await save();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it('counts a card line of only spaces as none', async () => {
    await draft({ ...generated, cardLine: undefined });
    await userEvent.type(screen.getByLabelText('Card line'), '   ');
    await save();
    expect(screen.getByText('Add a card line before saving.')).toHaveClass('text-error');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('shows it saving, with the earlier problem gone, then closes', async () => {
    const saving = deferred<string>();
    saveSpy.mockReturnValueOnce(saving.promise);
    generateSpy.mockResolvedValue({ ...generated, cardLine: undefined });
    const onClose = vi.fn();
    // No onSaved: closing is all there is to do.
    render(<AddActivity onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await save();
    expect(screen.getByText('Add a card line before saving.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Card line'), 'Ridge loop with bay views.');
    await save();
    const busy = await screen.findByRole('button', { name: 'Saving' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.queryByText('Add a card line before saving.')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await settle(saving, 'castle-rock');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('won’t save a card line or a card name past its cap', async () => {
    await draft({ ...generated, cardLine: 'x'.repeat(51) });
    await save();
    expect(screen.getByText('Shorten the card line to 50 characters.')).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Card line'));
    await userEvent.type(screen.getByLabelText('Card line'), 'Ridge loop with bay views.');
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), LONG_NAME);
    await userEvent.type(screen.getByLabelText('Card name'), 'y'.repeat(41));
    await save();
    expect(screen.getByText('Shorten the card name to 40 characters.')).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('saves an edit of a place from before card lines without one', async () => {
    render(
      <AddActivity onClose={() => {}} editActivity={{ ...baseActivity, cardLine: undefined }} />,
    );
    await save();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].cardLine).toBeUndefined();
  });

  it('clears a card line emptied by hand', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    await userEvent.clear(screen.getByLabelText('Card line'));
    await save();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].cardLine).toBeUndefined();
  });
});

describe('AddActivity — a region from anywhere (#274)', () => {
  it('asks for one when the draft came without, and saves the one picked', async () => {
    generateSpy.mockResolvedValue({
      name: 'Navajo Loop',
      shortDescription: 'Down among the hoodoos',
      cardLine: 'A line that fits on a card.',
      category: 'hiking',
      city: 'Bryce Canyon City',
      lat: 37.62,
      lng: -112.17,
      duration: '1-2 Hours',
    });
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Navajo Loop');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    const region = await screen.findByRole('combobox', { name: 'Region' });
    expect(region).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    expect(screen.getByText('Choose a region before saving.')).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();

    await userEvent.click(region);
    await userEvent.type(region, 'utah');
    await userEvent.click(await screen.findByRole('option', { name: 'Utah, United States' }));
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].region).toBe('US-UT');
  });
});

describe('AddActivity — Escape in the region list (#274)', () => {
  it('closes the list and keeps the dialog, until the list is closed', async () => {
    const onClose = vi.fn();
    render(<AddActivity onClose={onClose} editActivity={baseActivity} />);
    const region = screen.getByRole('combobox', { name: 'Region' });
    await userEvent.click(region);
    await userEvent.type(region, 'kyo');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AddActivity — duplicates (#17)', () => {
  const generated: GeneratedFields = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    cardLine: 'A line that fits on a card.',
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
      await screen.findByText(
        'Another saved activity looks like this one too. Check it before saving.',
      ),
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
    // Unanswered isn't a match.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it("shows the look-alike when the server refuses one the check didn't see", async () => {
    dupSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([match('high')]);
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This looks like a duplicate of Castle Rock',
    );
    expect(screen.getByText('looks like a duplicate of Castle Rock')).toBeInTheDocument();
  });

  it('re-checks when the pin moves either way, not when only something else changes', async () => {
    await review();
    await waitFor(() => expect(dupSpy).toHaveBeenCalledTimes(1));
    await afterTimers(() =>
      fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Saratoga' } }),
    );
    expect(dupSpy).toHaveBeenCalledTimes(1);
    await afterTimers(() => dropPin(37.3, -122.1));
    expect(dupSpy).toHaveBeenCalledTimes(2);
    await afterTimers(() => dropPin(37.3, -122.2));
    expect(dupSpy).toHaveBeenCalledTimes(3);
    expect(dupSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        location: { city: 'Saratoga', coords: { lat: 37.3, lng: -122.2 } },
      }),
    );
  });

  it('keeps the newest answer when an older one comes back late', async () => {
    const first = deferred<ReturnType<typeof match>[]>();
    dupSpy.mockReturnValueOnce(first.promise).mockResolvedValue([]);
    await review();
    await afterTimers(() =>
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Castle Rock Trailhead' },
      }),
    );
    expect(dupSpy).toHaveBeenCalledTimes(2);
    await settle(first, [match('high')]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forgets an answer still on its way once it goes Back', async () => {
    const first = deferred<ReturnType<typeof match>[]>();
    const second = deferred<ReturnType<typeof match>[]>();
    dupSpy.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await review();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: /Save activity/ });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await settle(first, [match('high')]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await settle(second, [match('possible')]);
    expect(screen.getByRole('status')).toHaveTextContent('You may already have Castle Rock');
  });

  it('drops a re-check still waiting when it goes Back', async () => {
    await review();
    await waitFor(() => expect(dupSpy).toHaveBeenCalledTimes(1));
    await afterTimers(() => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Castle Rock Park' } });
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    expect(dupSpy).toHaveBeenCalledTimes(1);
  });

  it('drops a re-check still waiting when the dialog closes', async () => {
    generateSpy.mockResolvedValue(generated);
    const { unmount } = render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await waitFor(() => expect(dupSpy).toHaveBeenCalledTimes(1));
    await afterTimers(() => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Castle Rock Park' } });
      unmount();
    });
    expect(dupSpy).toHaveBeenCalledTimes(1);
  });

  it('checks again after a failed save only when the server found a look-alike', async () => {
    saveSpy.mockRejectedValueOnce(new Error('Server down'));
    await review();
    await userEvent.click(saveButton());
    expect(await screen.findByText('Server down')).toHaveClass('text-error');
    expect(dupSpy).toHaveBeenCalledTimes(2);
  });

  it('checks nothing while an edit is renamed', async () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    await afterTimers(() =>
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } }),
    );
    expect(dupSpy).not.toHaveBeenCalled();
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
    cardLine: 'A line that fits on a card.',
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

  it('sends a trail picked from the others with its own numbers, not the draft’s', async () => {
    const T = 'https://www.alltrails.com/trail/us/california/';
    generated.allTrailsOptions = [
      { url: 'https://www.alltrails.com/trail/castle-rock', title: 'Castle Rock', description: '' },
      { url: `${T}saratoga-gap`, title: 'Saratoga Gap', description: '', miles: 5.2, feet: 900 },
    ];
    try {
      await review();
      await userEvent.click(screen.getByRole('button', { name: /Not the right trail/ }));
      await userEvent.click(screen.getByText('Saratoga Gap'));
      await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
      await waitFor(() => expect(suggestSpy).toHaveBeenCalledTimes(1));
      const [sent] = suggestSpy.mock.calls[0] as [Activity];
      expect(sent).toMatchObject({
        allTrailsUrl: `${T}saratoga-gap`,
        hikeDistanceMiles: 5.2,
        hikeElevationFeet: 900,
      });
      expect(sent.allTrailsRating).toBeUndefined();
    } finally {
      delete generated.allTrailsOptions;
    }
  });

  it('forgets the trails a draft found once the form goes back, or is filled by hand', async () => {
    generated.allTrailsOptions = [
      { url: 'https://www.alltrails.com/trail/castle-rock', title: 'Castle Rock', description: '' },
      { url: 'https://www.alltrails.com/trail/x/y/z', title: 'Z', description: '' },
    ];
    try {
      await review();
      expect(screen.getByRole('button', { name: /Not the right trail/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Fill them in yourself' }));
      await userEvent.type(
        screen.getByLabelText('AllTrails URL'),
        'https://www.alltrails.com/trail/a/b/c',
      );
      expect(screen.queryByRole('button', { name: /Not the right trail|Pick from/ })).toBeNull();
    } finally {
      delete generated.allTrailsOptions;
    }
  });

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
    const envelope = getIcon('mark_email_read');
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
      {
        id: 'castle-rock',
        name: 'Castle Rock',
        city: 'Los Gatos',
        distanceMeters: 30,
        confidence: 'high',
      },
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

describe('AddActivity — a suggestion filled in by hand (#260)', () => {
  const ASSIST_LIMIT = new CombinedGraphQLErrors({
    errors: [
      {
        message: "You've used today's AI drafts. Try again tomorrow.",
        extensions: { code: 'FORBIDDEN', appCode: 'assist_limit' },
      },
    ],
  });

  function openSuggest() {
    ownerState.isOwner = false;
    render(<AddActivity onClose={() => {}} suggest />);
  }

  async function byHand(title = 'Castle Rock', notes = '') {
    openSuggest();
    if (title) await userEvent.type(screen.getByLabelText('Title'), title);
    if (notes) await userEvent.type(screen.getByLabelText('Notes / links (optional)'), notes);
    await userEvent.click(screen.getByRole('button', { name: 'Fill them in yourself' }));
  }

  it("is offered to a friend from the start, but not in the owners' Add", () => {
    openSuggest();
    expect(screen.getByText(/or you can fill it in yourself/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fill them in yourself' })).toBeInTheDocument();
  });

  it("isn't offered to an owner adding an activity", () => {
    render(<AddActivity onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Fill/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/fill it in yourself/)).not.toBeInTheDocument();
  });

  it('starts the review from the title and notes, without spending a draft', async () => {
    await byHand('  Castle Rock  ', 'https://example.com/castle-rock');
    expect(screen.getByRole('heading', { name: 'Review & send' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Castle Rock');
    expect(screen.getByLabelText('Short description')).toHaveValue('');
    expect(screen.getByLabelText('City')).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveValue('https://example.com/castle-rock');
    // Nothing is guessed about the place: its menus wait for a choice.
    for (const menu of ['Category', 'Duration']) {
      expect(screen.getByLabelText(menu)).toHaveValue('');
      expect(screen.getByLabelText(menu)).toHaveDisplayValue('Choose');
    }
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveValue('');
    expect(screen.getByText('Tap the map to drop a pin.')).toBeInTheDocument();
    expect(generateSpy).not.toHaveBeenCalled();
    // No pin yet, so nothing to compare with the catalog.
    expect(dupSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('leaves out notes that are only blank', async () => {
    await byHand('Castle Rock', '   ');
    expect(screen.getByLabelText('Notes')).toHaveValue('');
  });

  it('needs a title that isn’t only spaces, and stops asking once it has one', async () => {
    await byHand('   ');
    expect(screen.getByText('Title is required')).toHaveClass('text-error');
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: 'Fill them in yourself' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Castle Rock');
    expect(screen.queryByText('Title is required')).not.toBeInTheDocument();
  });

  it('counts a name of only spaces as missing', async () => {
    await byHand();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(screen.getByText(/^Add a name, a short description/)).toBeInTheDocument();
  });

  it('says what’s still missing, not an earlier failure, once a field is emptied', async () => {
    suggestSpy.mockRejectedValueOnce(new Error('Network down'));
    await byHand();
    await userEvent.type(screen.getByLabelText('Short description'), 'Ridgeline hike');
    await userEvent.type(screen.getByLabelText('Card line'), 'A line that fits on a card.');
    await userEvent.type(screen.getByLabelText('City'), 'Los Gatos');
    await choose();
    dropPin(37.23, -122.1);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('City'));
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(screen.getByText('Add a city before sending.')).toBeInTheDocument();
    expect(screen.queryByText('Network down')).not.toBeInTheDocument();
  });

  it('needs a title first, as Generate does', async () => {
    await byHand('');
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Suggest activity' })).toBeInTheDocument();
  });

  // Region is searched for and picked (#274).
  async function pickRegion(search: string, label: string) {
    await userEvent.click(screen.getByRole('combobox', { name: 'Region' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Region' }), search);
    await userEvent.click(await screen.findByRole('option', { name: label }));
  }

  async function choose() {
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'hiking');
    await pickRegion('south', 'South Bay');
    await userEvent.selectOptions(screen.getByLabelText('Duration'), 'Half Day');
  }

  it("won't send until it has what a card and a pin need, saying what's left as it's filled in", async () => {
    await byHand();
    expect(screen.queryByText(/before sending/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(
      screen.getByText(
        'Add a short description, a card line, a category, a region, a duration, a city and a pin on the map before sending.',
      ),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Short description'), 'Ridgeline hike');
    await userEvent.type(screen.getByLabelText('Card line'), 'A line that fits on a card.');
    await choose();
    // The message follows the fields, without another Send.
    expect(
      screen.getByText('Add a name, a city and a pin on the map before sending.'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Castle Rock');
    await userEvent.type(screen.getByLabelText('City'), 'Los Gatos');
    expect(screen.getByText('Add a pin on the map before sending.')).toBeInTheDocument();
    dropPin(37.23, -122.1);
    expect(screen.queryByText(/before sending/)).not.toBeInTheDocument();
    expect(suggestSpy).not.toHaveBeenCalled();
    expect(dupSpy).not.toHaveBeenCalled();
  });

  it('counts blank text as missing', async () => {
    await byHand();
    await userEvent.type(screen.getByLabelText('Short description'), '   ');
    await userEvent.type(screen.getByLabelText('Card line'), '  ');
    await userEvent.type(screen.getByLabelText('City'), ' ');
    await choose();
    dropPin(37.23, -122.1);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(
      screen.getByText('Add a short description, a card line and a city before sending.'),
    ).toBeInTheDocument();
  });

  it('asks for each menu left unchosen', async () => {
    await byHand();
    await userEvent.type(screen.getByLabelText('Short description'), 'Ridgeline hike');
    await userEvent.type(screen.getByLabelText('Card line'), 'A line that fits on a card.');
    await userEvent.type(screen.getByLabelText('City'), 'Los Gatos');
    dropPin(37.23, -122.1);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(
      screen.getByText('Add a category, a region and a duration before sending.'),
    ).toBeInTheDocument();
    await pickRegion('oregon', 'Oregon, United States');
    expect(screen.getByText('Add a category and a duration before sending.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Duration'), 'Weekend');
    expect(screen.getByText('Add a category before sending.')).toBeInTheDocument();
    // A chosen menu has no "Choose" left in it.
    expect(screen.getByLabelText('Duration')).not.toHaveDisplayValue('Choose');
    expect(screen.queryAllByRole('option', { name: 'Choose' })).toHaveLength(1);
    expect(suggestSpy).not.toHaveBeenCalled();
  });

  it('drops what the review step said on the way Back to the form', async () => {
    await byHand();
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(screen.getByText(/before sending/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Suggest activity' })).toBeInTheDocument();
    expect(screen.queryByText(/before sending/)).not.toBeInTheDocument();
    // And it isn't waiting on the review step when they come back.
    await userEvent.click(screen.getByRole('button', { name: 'Fill them in yourself' }));
    expect(screen.queryByText(/before sending/)).not.toBeInTheDocument();
  });

  it('drops an earlier failure on the way Back too', async () => {
    suggestSpy.mockRejectedValueOnce(new Error('Network down'));
    await byHand();
    await userEvent.type(screen.getByLabelText('Short description'), 'Ridgeline hike');
    await userEvent.type(screen.getByLabelText('Card line'), 'A line that fits on a card.');
    await userEvent.type(screen.getByLabelText('City'), 'Los Gatos');
    await choose();
    dropPin(37.23, -122.1);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByText('Network down')).not.toBeInTheDocument();
  });

  it('goes through the same checks as a drafted one once filled in', async () => {
    await byHand();
    await userEvent.type(screen.getByLabelText('Short description'), 'Ridgeline hike');
    await userEvent.type(screen.getByLabelText('Card line'), 'A line that fits on a card.');
    await userEvent.type(screen.getByLabelText('City'), 'Los Gatos');
    await choose();
    dropPin(37.23, -122.1);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
    // The look-alike check runs on send, as for a draft; the server's own
    // checks (the pending cap, links, size) are the same mutation's.
    expect(dupSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Castle Rock',
        location: { city: 'Los Gatos', coords: { lat: 37.23, lng: -122.1 } },
      }),
    );
    expect(suggestSpy).toHaveBeenCalledTimes(1);
    const [sent, options] = suggestSpy.mock.calls[0] as [Activity, { allowDuplicate: boolean }];
    expect(sent).toMatchObject({
      name: 'Castle Rock',
      shortDescription: 'Ridgeline hike',
      cardLine: 'A line that fits on a card.',
      category: 'hiking',
      region: 'south-bay',
      duration: 'Half Day',
      coverImage: '',
    });
    expect(sent.contributors).toBeUndefined();
    expect(options).toEqual({ allowDuplicate: false });
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('holds a look-alike found once the pin is down', async () => {
    dupSpy.mockResolvedValue([
      {
        id: 'castle-rock',
        name: 'Castle Rock',
        city: 'Los Gatos',
        distanceMeters: 30,
        confidence: 'high',
      },
    ]);
    await byHand();
    await choose();
    // Renaming with no pin asks nothing: no look-alike check is even pending
    // once every timer the rename left has run.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const name = screen.getByLabelText<HTMLInputElement>('Name');
      fireEvent.change(name, { target: { value: `${name.value} Park` } });
      await act(() => vi.runOnlyPendingTimersAsync());
    } finally {
      vi.useRealTimers();
    }
    expect(dupSpy).not.toHaveBeenCalled();
    dropPin(37.23, -122.1);
    await waitFor(() => expect(dupSpy).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(await screen.findByRole('button', { name: 'Send anyway' })).toBeInTheDocument();
  });

  it("leads to filling in by hand once today's drafts are used up", async () => {
    openSuggest();
    generateSpy.mockRejectedValue(ASSIST_LIMIT);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    const fill = await screen.findByRole('button', { name: 'Fill in by hand' });
    expect(fill).toHaveFocus();
    expect(fill).toHaveAccessibleDescription(
      "You've used today's AI drafts. You can still fill in the details yourself.",
    );
    expect(screen.getByRole('status')).toHaveTextContent("You've used today's AI drafts.");
    // No dead end, and no Generate to fail again; the server's own wording
    // isn't shown as an error.
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fill them in yourself' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Try again tomorrow/)).not.toBeInTheDocument();
    await userEvent.click(fill);
    expect(screen.getByRole('heading', { name: 'Review & send' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Castle Rock');
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it('fills in by hand on Enter once the drafts are used up', async () => {
    openSuggest();
    generateSpy.mockRejectedValue(ASSIST_LIMIT);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock{Enter}');
    await screen.findByRole('button', { name: 'Fill in by hand' });
    await userEvent.type(screen.getByLabelText('Title'), '{Enter}');
    expect(screen.getByRole('heading', { name: 'Review & send' })).toBeInTheDocument();
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps Generate after any other failure', async () => {
    openSuggest();
    generateSpy.mockRejectedValue(new Error('Gemini is busy'));
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(await screen.findByText('Gemini is busy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('leaves an owner with the error as it was', async () => {
    generateSpy.mockRejectedValue(ASSIST_LIMIT);
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(
      await screen.findByText("You've used today's AI drafts. Try again tomorrow."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fill/ })).not.toBeInTheDocument();
  });

  it('checks a drafted suggestion too, if a field is emptied', async () => {
    ownerState.isOwner = false;
    generateSpy.mockResolvedValue({
      name: 'Castle Rock',
      shortDescription: 'Ridgeline hike',
      cardLine: 'A line that fits on a card.',
      category: 'hiking',
      region: 'south-bay',
      city: 'Los Gatos',
      lat: 37.23,
      lng: -122.1,
      duration: 'Half Day',
    } satisfies GeneratedFields);
    render(<AddActivity onClose={() => {}} suggest />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await userEvent.clear(await screen.findByLabelText('City'));
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(screen.getByText('Add a city before sending.')).toBeInTheDocument();
    expect(suggestSpy).not.toHaveBeenCalled();
  });
});

describe('AddActivity — seeded from a shared post (#6)', () => {
  const generated: GeneratedFields = {
    name: 'Carson Falls',
    shortDescription: 'Tiered falls',
    cardLine: 'A line that fits on a card.',
    category: 'hiking',
    region: 'north-bay',
    city: 'Fairfax',
    lat: 37.98,
    lng: -122.62,
    duration: 'Half Day',
  };
  const seed = {
    title: 'Carson Falls, Fairfax',
    notes: 'From an Instagram reel: https://www.instagram.com/reel/x/',
  };

  it('drafts the place as it opens, once, from the seeded title and notes', async () => {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} seed={seed} />);
    // Straight to drafting: no form to fill in first.
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument();
    await screen.findByRole('button', { name: /Save activity/ });
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy).toHaveBeenCalledWith(seed.title, seed.notes);
  });

  it('keeps the post it came from as where it was found, through to the save', async () => {
    generateSpy.mockResolvedValue(generated);
    const reel = 'https://www.instagram.com/reel/x/';
    render(<AddActivity onClose={() => {}} seed={seed} source={reel} />);
    const field = await screen.findByLabelText('Where you found it (optional)');
    expect(field).toHaveValue(reel);
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].sourceUrl).toBe(reel);
  });

  it('keeps it for a place added by hand from a post too', async () => {
    ownerState.isOwner = false;
    const reel = 'https://www.instagram.com/reel/x/';
    render(
      <AddActivity
        onClose={() => {}}
        suggest
        seed={{ title: '', notes: seed.notes }}
        source={reel}
      />,
    );
    await userEvent.type(screen.getByLabelText('Title'), 'Carson Falls');
    await userEvent.click(screen.getByRole('button', { name: 'Fill them in yourself' }));
    expect(await screen.findByLabelText('Where you found it (optional)')).toHaveValue(reel);
  });

  it('lets where it was found be changed, or cleared', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{ ...baseActivity, sourceUrl: 'https://example.com/a' }}
      />,
    );
    const field = screen.getByLabelText('Where you found it (optional)');
    expect(field).toHaveValue('https://example.com/a');
    await userEvent.clear(field);
    await userEvent.type(field, '  https://example.com/b ');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].sourceUrl).toBe('https://example.com/b');
  });

  it('saves no source once it’s cleared', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{ ...baseActivity, sourceUrl: 'https://example.com/a' }}
      />,
    );
    await userEvent.clear(screen.getByLabelText('Where you found it (optional)'));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].sourceUrl).toBeUndefined();
  });

  it('asks for a dog rules page only for a dog-friendly place (#296)', async () => {
    render(
      <AddActivity onClose={() => {}} editActivity={{ ...baseActivity, dogFriendly: false }} />,
    );
    expect(screen.queryByLabelText('Dog rules page (optional)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Dog friendly'), 'yes');
    const field = screen.getByLabelText('Dog rules page (optional)');
    expect(field).toHaveAttribute('type', 'url');
    await userEvent.type(field, ' https://www.parks.ca.gov/dogs ');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const saved = (saveSpy.mock.calls[0] as [Activity])[0];
    expect(saved.dogRulesUrl).toBe('https://www.parks.ca.gov/dogs');
    expect(saved.dogFriendly).toBe(true);
  });

  it('drops the dog rules page once dogs aren’t welcome (#296)', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{
          ...baseActivity,
          dogFriendly: true,
          dogRulesUrl: 'https://www.parks.ca.gov/dogs',
        }}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Dog friendly'), 'no');
    expect(screen.queryByLabelText('Dog rules page (optional)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const saved = (saveSpy.mock.calls[0] as [Activity])[0];
    expect(saved.dogFriendly).toBe(false);
    expect(saved.dogRulesUrl).toBeUndefined();
  });

  it('saves no dog rules page once it’s cleared (#296)', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{
          ...baseActivity,
          dogFriendly: true,
          dogRulesUrl: 'https://www.parks.ca.gov/dogs',
        }}
      />,
    );
    const field = screen.getByLabelText('Dog rules page (optional)');
    expect(field).toHaveValue('https://www.parks.ca.gov/dogs');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].dogRulesUrl).toBeUndefined();
  });

  it('keeps a draft’s dog rules page (#296)', async () => {
    generateSpy.mockResolvedValue({
      ...generated,
      dogFriendly: true,
      dogRulesUrl: 'https://www.ebparks.org/dogs',
    });
    render(<AddActivity onClose={() => {}} seed={seed} />);
    expect(await screen.findByLabelText('Dog rules page (optional)')).toHaveValue(
      'https://www.ebparks.org/dogs',
    );
  });

  it('opens on the form, with the notes kept, for a seed with no place yet', async () => {
    render(<AddActivity onClose={() => {}} seed={{ title: '', notes: seed.notes }} />);
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Notes / links (optional)')).toHaveValue(seed.notes);
    // A turn: the draft would start on one (setTimeout 0).
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(generateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Title is required')).not.toBeInTheDocument();
  });

  it('falls back to the form, seeded, when the draft fails', async () => {
    generateSpy.mockRejectedValue(new Error('Gemini is down'));
    render(<AddActivity onClose={() => {}} seed={seed} />);
    expect(await screen.findByText('Gemini is down')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue(seed.title);
  });
});

describe('AddActivity — the park it’s part of (#269)', () => {
  const PARK: Activity = {
    ...baseActivity,
    id: 'test-park',
    name: 'Test Seashore',
    completed: false,
  };
  const generated: GeneratedFields = {
    name: 'Test Lighthouse',
    shortDescription: 'An 1870 lighthouse',
    cardLine: 'A line that fits on a card.',
    category: 'scenic',
    region: 'north-bay',
    city: 'Inverness',
    lat: 37.9956,
    lng: -123.0224,
    duration: 'Full Day',
    parentId: PARK.id,
  };

  it('starts a draft in the park Gemini placed it in, for the owner to keep or change', async () => {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />, { activities: [PARK] });
    await userEvent.type(screen.getByLabelText('Title'), 'Point Reyes Lighthouse');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    const partOf = await screen.findByLabelText('Part of (optional)');
    expect(partOf).toHaveValue(PARK.id);
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].parentId).toBe(PARK.id);
  });

  it('leaves it to the owners on a suggestion', async () => {
    ownerState.isOwner = false;
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} suggest />, { activities: [PARK] });
    await userEvent.type(screen.getByLabelText('Title'), 'Point Reyes Lighthouse');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: 'Send suggestion' });
    expect(screen.queryByLabelText('Part of (optional)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    await waitFor(() => expect(suggestSpy).toHaveBeenCalledTimes(1));
    expect((suggestSpy.mock.calls[0] as [Activity])[0].parentId).toBeUndefined();
  });
});

describe('AddActivity — drafting', () => {
  const generated: GeneratedFields = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    cardLine: 'A line that fits on a card.',
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

  it('says what it’s researching until the draft comes, asking with the title and notes trimmed', async () => {
    const answer = deferred<GeneratedFields>();
    generateSpy.mockReturnValue(answer.promise);
    render(<AddActivity onClose={() => {}} />);
    expect(screen.queryByText(/Researching/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Title'), '  Castle Rock ');
    await userEvent.type(screen.getByLabelText('Notes / links (optional)'), ' Bring water ');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(screen.getByText(/Researching/)).toHaveTextContent(/Researching\s+Castle Rock/);
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(generateSpy).toHaveBeenCalledWith('Castle Rock', 'Bring water');
    await settle(answer, generated);
    expect(screen.queryByText(/Researching/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Castle Rock');
    // The review's own notes, for the activity.
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Go early' } });
    expect((await saved()).notes).toBe('Go early');
  });

  it('needs a title that isn’t only spaces', async () => {
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), '   ');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(screen.getByText('Title is required')).toHaveClass('text-error');
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('drafts on submit without leaving the page', async () => {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Castle Rock' } });
    const form = screen.getByLabelText('Title').closest('form');
    if (!form) throw new Error('no form');
    // false: the submit was handled here, so the browser doesn't navigate.
    expect(fireEvent.submit(form)).toBe(false);
    await screen.findByRole('button', { name: /Save activity/ });
  });

  it('drafts again after a failure, leaving the failure behind', async () => {
    generateSpy.mockRejectedValueOnce(new Error('Gemini is busy')).mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(await screen.findByText('Gemini is busy')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: /Save activity/ });
    expect(screen.queryByText('Gemini is busy')).not.toBeInTheDocument();
  });

  it('goes Back to the form with the title kept and the review gone', async () => {
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Castle Rock');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText(/Researching/)).not.toBeInTheDocument();
  });

  it.each([
    ['  --Castle  Rock!! (Saratoga)--', 'castle-rock-saratoga'],
    [
      'Point Reyes National Seashore Lighthouse and Chimney Rock Walk',
      'point-reyes-national-seashore-lighthouse-and-chi',
    ],
  ])('saves “%s” as %s', async (name, id) => {
    generateSpy.mockResolvedValue({ ...generated, name });
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Castle Rock');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: /Save activity/ });
    expect((await saved()).id).toBe(id);
  });

  it('makes up an id for a name with nothing to make one from', async () => {
    generateSpy.mockResolvedValue({ ...generated, name: '灯台' });
    render(<AddActivity onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Title'), '灯台');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await screen.findByRole('button', { name: /Save activity/ });
    expect((await saved()).id).toMatch(/^activity-[a-z0-9]+$/);
  });

  it('sends a suggestion under the drafted name’s id, not the title’s', async () => {
    ownerState.isOwner = false;
    generateSpy.mockResolvedValue(generated);
    render(<AddActivity onClose={() => {}} suggest />);
    await userEvent.type(screen.getByLabelText('Title'), 'castle');
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send suggestion' }));
    await waitFor(() => expect(suggestSpy).toHaveBeenCalledTimes(1));
    expect((suggestSpy.mock.calls[0] as [Activity])[0].id).toBe('castle-rock');
  });
});

describe('AddActivity — opening and closing', () => {
  it('closes on Escape through the onClose it has now, and not once it’s gone', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<AddActivity onClose={first} />);
    rerender(<AddActivity onClose={second} />);
    await userEvent.keyboard('{Escape}');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drafts nothing from a seed when closed before it starts', async () => {
    const { unmount } = render(
      <AddActivity onClose={() => {}} seed={{ title: 'Carson Falls', notes: '' }} />,
    );
    unmount();
    // A turn: the draft would start on one (setTimeout 0).
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

describe('AddActivity — the review’s fields', () => {
  const PARK: Activity = { ...baseActivity, id: 'test-park', name: 'Test Seashore' };

  async function saved() {
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    return (saveSpy.mock.calls[0] as [Activity])[0];
  }

  it('saves the rest of the fields as edited', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{ ...baseActivity, durationDetail: '~1h drive', parkType: 'state' }}
      />,
      { activities: [PARK] },
    );
    expect(screen.getByLabelText('Duration detail')).toHaveValue('~1h drive');
    expect(screen.getByLabelText('Park type (optional)')).toHaveValue('state');
    expect(screen.getByText(/refreshed from AllTrails when the URL changes/)).toBeInTheDocument();
    const change = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    change('Long description', 'A longer story.');
    change('Duration detail', 'Two hours');
    change('Difficulty', 'advanced');
    change('Park type (optional)', 'national');
    change('Part of (optional)', PARK.id);
    expect(await saved()).toMatchObject({
      longDescription: 'A longer story.',
      durationDetail: 'Two hours',
      difficulty: 'advanced',
      parkType: 'national',
      parentId: PARK.id,
    });
  });

  it('shows the cover, and hides one that fails to load', () => {
    render(<AddActivity onClose={() => {}} editActivity={baseActivity} />);
    const cover = screen.getByRole('img', { name: 'Original Name' });
    expect(cover).toHaveAttribute('src', baseActivity.coverImage);
    fireEvent.error(cover);
    expect(cover).toHaveStyle({ display: 'none' });
  });

  it('shows no cover without one', () => {
    render(<AddActivity onClose={() => {}} editActivity={{ ...baseActivity, coverImage: '' }} />);
    expect(screen.queryByRole('img', { name: 'Original Name' })).not.toBeInTheDocument();
  });

  it('asks for a restaurant’s details only for food, and saves them as edited', async () => {
    render(
      <AddActivity
        onClose={() => {}}
        editActivity={{
          ...baseActivity,
          category: 'food',
          cuisine: 'Thai',
          priceRange: '$$',
          hours: 'Daily 5–10pm',
          dietary: ['vegan', 'gluten-free'],
          reservationUrl: 'https://resy.com/a',
          menuUrl: 'https://example.com/menu',
        }}
      />,
    );
    expect(screen.getByText('RESTAURANT DETAILS')).toBeInTheDocument();
    const field = (label: string) => screen.getByLabelText(label);
    expect(field('Cuisine')).toHaveValue('Thai');
    expect(field('Price range')).toHaveValue('$$');
    expect(field('Hours')).toHaveValue('Daily 5–10pm');
    expect(field('Dietary options (comma-separated)')).toHaveValue('vegan, gluten-free');
    expect(field('Reservation URL')).toHaveValue('https://resy.com/a');
    expect(field('Menu / website URL')).toHaveValue('https://example.com/menu');
    expect(
      [...screen.getByLabelText<HTMLSelectElement>('Price range').options].map(
        (o) => o.textContent,
      ),
    ).toEqual(['—', '$', '$$', '$$$', '$$$$']);
    const change = (label: string, value: string) =>
      fireEvent.change(field(label), { target: { value } });
    change('Cuisine', 'Lao');
    change('Price range', '$$$');
    change('Hours', 'Thu–Mon 11am–8pm');
    change('Dietary options (comma-separated)', ' vegetarian , , halal ');
    change('Reservation URL', 'https://resy.com/b');
    change('Menu / website URL', 'https://example.com/menu2');
    expect(await saved()).toMatchObject({
      cuisine: 'Lao',
      priceRange: '$$$',
      hours: 'Thu–Mon 11am–8pm',
      dietary: ['vegetarian', 'halal'],
      reservationUrl: 'https://resy.com/b',
      menuUrl: 'https://example.com/menu2',
    });
  });

  it('keeps the restaurant’s details out of the way for anything else', async () => {
    render(<AddActivity onClose={() => {}} editActivity={{ ...baseActivity, category: 'food' }} />);
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'hiking');
    expect(screen.queryByText('RESTAURANT DETAILS')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cuisine')).not.toBeInTheDocument();
  });
});

describe('AddActivity — the pin’s map', () => {
  const at = (lat: number, lng: number): Activity => ({
    ...baseActivity,
    location: { ...baseActivity.location, coords: { lat, lng } },
  });
  const open = (activity: Activity) =>
    render(<AddActivity onClose={() => {}} editActivity={activity} />);

  it('opens on the pin, drawn by its tip, in a map with room to show', () => {
    open(at(37.5, -122.5));
    const map = screen.getByTestId('map-container');
    expect(map).toHaveAttribute('data-center', '37.5,-122.5');
    expect(map).toHaveAttribute('data-zoom', '11');
    expect(map).toHaveStyle({ height: '100%', width: '100%' });
    expect(map.parentElement).toHaveStyle({ height: '280px' });
    const pin = screen.getByTestId('map-pin');
    expect(pin).toHaveAttribute('data-position', '37.5,-122.5');
    expect(pin).toHaveAttribute('data-icon-size', '28,28');
    expect(pin).toHaveAttribute('data-icon-anchor', '14,28');
    expect(screen.getByText(/^37\.50000, -122\.50000 — drag the pin/)).toBeInTheDocument();
  });

  it.each([
    ['no latitude', NaN, -122.5],
    ['no longitude', 37.5, NaN],
    ['0, 0', 0, 0],
  ])('opens on the Bay Area with no pin for coordinates of %s', (_, lat, lng) => {
    mapView.center = { lat: 10, lng: 10 };
    open(at(lat, lng));
    const map = screen.getByTestId('map-container');
    expect(map).toHaveAttribute('data-center', '37.2872,-121.95');
    expect(map).toHaveAttribute('data-zoom', '8');
    expect(screen.queryByTestId('map-pin')).not.toBeInTheDocument();
    expect(screen.getByText('Tap the map to drop a pin.')).toBeInTheDocument();
    expect(mapView.setView).not.toHaveBeenCalled();
  });

  it.each([
    ['on the equator', 0, 10.5],
    ['on the meridian', 45.5, 0],
  ])('draws a pin %s, and goes to it', (_, lat, lng) => {
    open(at(lat, lng));
    expect(screen.getByTestId('map-pin')).toHaveAttribute('data-position', `${lat},${lng}`);
    expect(mapView.setView).toHaveBeenCalledWith([lat, lng], 11);
  });

  it('brings a pin outside the view into it, keeping a closer zoom', () => {
    mapView.zoom = 14;
    open(at(37.5, -122.5));
    expect(mapView.setView).toHaveBeenCalledExactlyOnceWith([37.5, -122.5], 14);
  });

  it.each([
    ['around it', { lat: 37.2, lng: -122.2 }, 0],
    ['half a degree south of it', { lat: 37, lng: -122.5 }, 0],
    ['half a degree east of it', { lat: 37.5, lng: -122 }, 0],
    ['further south', { lat: 36.9, lng: -122.5 }, 1],
    ['further east', { lat: 37.5, lng: -121.9 }, 1],
  ])('with the view centred %s, moves it %i times to the pin', (_, center, times) => {
    mapView.center = center;
    open(at(37.5, -122.5));
    expect(mapView.setView).toHaveBeenCalledTimes(times);
  });

  it('follows the pin as it moves, but not for a nudge under a millionth of a degree', () => {
    // Panned well away from it.
    mapView.center = { lat: 10, lng: 10 };
    open(at(37.5, -122.5));
    expect(mapView.setView).toHaveBeenCalledTimes(1);
    dropPin(37.5 + 1e-7, -122.5 - 1e-7);
    expect(mapView.setView).toHaveBeenCalledTimes(1);
    dropPin(37.5 + 1e-7, -122.4);
    expect(mapView.setView).toHaveBeenCalledTimes(2);
    dropPin(37.6, -122.4 + 1e-7);
    expect(mapView.setView).toHaveBeenCalledTimes(3);
    expect(mapView.setView).toHaveBeenLastCalledWith([37.6, -122.4 + 1e-7], 11);
  });

  it('moves the pin where it’s dragged to, and saves it there', async () => {
    open(baseActivity);
    mapView.dragTo = { lat: 37.9, lng: -122.6 };
    act(() => mapEvents.dragend?.());
    expect(screen.getByText(/^37\.90000, -122\.60000 — drag the pin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save activity/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect((saveSpy.mock.calls[0] as [Activity])[0].location.coords).toEqual({
      lat: 37.9,
      lng: -122.6,
    });
  });
});
