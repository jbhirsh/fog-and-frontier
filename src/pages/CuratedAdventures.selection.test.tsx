import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../test/render';
import { MemoryRouter } from 'react-router-dom';
import type { InitialEntry } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { Activity } from '../data/types';
import { completedHike, muirWoods } from '../test/fixtures';
import { RouteStateProbe } from '../test/RouteStateProbe';

// Selecting places for a trip (#112): a card tap toggles it while selecting,
// and the bar adds the selection to the trip the user arrived from, or opens
// the trip dialog. The dialog and the per-card dropdown have their own tests;
// here they are stand-ins that report what the page gave them.

const trips = vi.hoisted(() => ({ addActivityToTrip: vi.fn() }));
vi.mock('../lib/userTrips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/userTrips')>()),
  addActivityToTrip: trips.addActivityToTrip,
}));

vi.mock('../components/ActivityMap', () => ({ ActivityMap: () => null }));

vi.mock('../components/AddToTripDialog', () => ({
  AddToTripDialog: ({
    activityIds,
    onClose,
    onAdded,
  }: {
    activityIds: string[];
    onClose: () => void;
    onAdded: (trip: { title: string }, added: number, skipped: number) => void;
  }) => (
    <div role="dialog" aria-label="Add to trip">
      dialog for {activityIds.join(',')}
      <button type="button" onClick={onClose}>
        dialog close
      </button>
      <button type="button" onClick={() => onAdded({ title: 'Tahoe' }, 2, 1)}>
        dialog added some
      </button>
      <button type="button" onClick={() => onAdded({ title: 'Tahoe' }, 0, 0)}>
        dialog added none
      </button>
    </div>
  ),
}));

vi.mock('../components/AddToTripDropdown', () => ({
  AddToTripDropdown: ({
    activityId,
    onAdded,
  }: {
    activityId: string;
    onAdded: (message: string) => void;
  }) => (
    <button type="button" onClick={() => onAdded(`dropdown added ${activityId}`)}>
      dropdown {activityId}
    </button>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

const SIGNED_IN: AuthState = { isLoaded: true, email: 'editor@example.com', name: null };

const TARGET_ENTRY: InitialEntry = {
  pathname: '/',
  state: { target_trip_id: 'trip-1', target_trip_title: 'Big Sur' },
};

function renderPage(entry: InitialEntry = '/', activities: Activity[] = [muirWoods]) {
  return render(
    <AuthCtx.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[entry]}>
        <CuratedAdventures />
        <RouteStateProbe />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities },
  );
}

function cardButton(container: HTMLElement, id: string) {
  const button = container.querySelector<HTMLElement>(
    `[data-activity-id="${id}"] button[aria-pressed]`,
  );
  if (!button) throw new Error(`card ${id} not selectable`);
  return button;
}

// The router's path, without its query or state.
const path = () => screen.getByTestId('route-state').textContent?.split(' ')[0];
const toast = () => screen.queryByText((_, el) => el?.getAttribute('aria-live') === 'polite');
const addButton = (name: string | RegExp) => screen.getByRole('button', { name });

// The toasts clear themselves on a timer; only setTimeout is faked, so the
// catalog's cached read and the mocked writes still settle on their own.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  trips.addActivityToTrip.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// Waits until an add's outcome shows. The add's awaits are mocked writes, so it
// settles in microtasks: this lets them land one at a time, inside act, until
// `check` passes, with no clock (setTimeout is faked, which RTL's waitFor
// would wait on forever).
async function settled(check: () => void) {
  for (let tries = 1; ; tries++) {
    await act(async () => {
      await Promise.resolve();
    });
    try {
      check();
      return;
    } catch (err) {
      if (tries === 50) throw err;
    }
  }
}

describe('Curated Adventures — selecting for a trip', () => {
  it('toggles a card in and out of the selection', () => {
    const { container } = renderPage();
    fireEvent.click(addButton(/Select for trip/));
    const card = cardButton(container, muirWoods.id);
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(addButton('Add to trip')).toBeDisabled();

    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(addButton('Add to trip')).toBeEnabled();
    expect(path()).toBe('/');

    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('ends the selection from the bar', () => {
    const { container } = renderPage(TARGET_ENTRY);
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(addButton('Cancel'));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(addButton(/Select for trip/)).toBeInTheDocument();
    fireEvent.click(addButton(/Select for trip/));
    // The trip target went with it.
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.queryByText(/Adding to/)).not.toBeInTheDocument();
  });

  it('caps a bulk add at fifty', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      ...muirWoods,
      id: `bulk-${i}`,
      name: `Bulk ${i}`,
    }));
    const { container } = renderPage('/', many);
    fireEvent.click(addButton(/Select for trip/));
    // The list shows a page at a time. By text, not role: a role query walks
    // every card's accessible name, seconds over a page this long.
    for (let more: HTMLElement | null; (more = screen.queryByText(/^Show more/));) {
      fireEvent.click(more);
    }
    // One render for the fifty taps, not one each: fifty renders of fifty-one
    // cards took seconds on a busy machine. The toggle updates from the state
    // before it, so batched taps add up as separate ones would.
    act(() => {
      for (const a of many.slice(0, 50)) cardButton(container, a.id).click();
    });
    expect(screen.getByText('50 selected')).toBeInTheDocument();
    expect(screen.queryByText(/Pick at most/)).not.toBeInTheDocument();
    expect(addButton('Add to trip')).toBeEnabled();
    expect(addButton('Add to trip')).not.toHaveAttribute('title');

    fireEvent.click(cardButton(container, 'bulk-50'));
    expect(screen.getByText('Pick at most 50 at a time.')).toBeInTheDocument();
    expect(addButton('Add to trip')).toBeDisabled();
    expect(addButton('Add to trip')).toHaveAttribute('title', 'Pick at most 50');
  });
});

describe('Curated Adventures — adding to the trip the user came from', () => {
  it('adds each selected place, then opens the trip', async () => {
    trips.addActivityToTrip
      .mockResolvedValueOnce({ alreadyOnTrip: false, tripPast: false })
      .mockResolvedValueOnce({ alreadyOnTrip: true, tripPast: false });
    const { container } = renderPage(TARGET_ENTRY, [muirWoods, completedHike]);
    expect(screen.getByText(/Adding to/)).toHaveTextContent('Adding to "Big Sur" · 0 selected');
    expect(addButton('Add to "Big Sur"')).toBeDisabled();
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(cardButton(container, completedHike.id));
    fireEvent.click(addButton('Add to "Big Sur"'));
    await settled(() => expect(path()).toBe('/trips/trip-1'));

    expect(trips.addActivityToTrip.mock.calls).toEqual([
      ['trip-1', muirWoods.id],
      ['trip-1', completedHike.id],
    ]);
    expect(path()).toBe('/trips/trip-1');
    expect(toast()).toHaveTextContent('Added 1 to "Big Sur" · 1 already on trip');
  });

  it('says only what happened', async () => {
    trips.addActivityToTrip.mockResolvedValue({ alreadyOnTrip: true, tripPast: false });
    const { container } = renderPage(TARGET_ENTRY);
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(addButton('Add to "Big Sur"'));
    await settled(() => expect(toast()).toHaveTextContent(/^1 already on trip$/));
    expect(path()).toBe('/trips/trip-1');
  });

  it('says nothing when nothing was added or skipped', async () => {
    trips.addActivityToTrip.mockResolvedValue({ alreadyOnTrip: false, tripPast: false });
    const { container } = renderPage(TARGET_ENTRY);
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(addButton('Add to "Big Sur"'));
    await settled(() => expect(toast()).toHaveTextContent(/^Added 1 to "Big Sur"$/));
  });

  it('shows the add in progress, and takes one press at a time', async () => {
    let finish: (v: { alreadyOnTrip: boolean; tripPast: boolean }) => void = () => {};
    trips.addActivityToTrip.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const { container } = renderPage(TARGET_ENTRY);
    fireEvent.click(cardButton(container, muirWoods.id));
    // Two presses before React re-renders: the button isn't disabled yet for
    // the second, so only the page's own guard stops it adding again.
    const add = addButton('Add to "Big Sur"');
    act(() => {
      add.click();
      add.click();
    });
    expect(trips.addActivityToTrip).toHaveBeenCalledTimes(1);
    expect(addButton('Adding…')).toBeDisabled();

    finish({ alreadyOnTrip: false, tripPast: false });
    await settled(() => expect(addButton('Add to "Big Sur"')).toBeEnabled());
  });

  it('drops a trip that has just become past, and says so', async () => {
    trips.addActivityToTrip.mockResolvedValue({ alreadyOnTrip: false, tripPast: true });
    const { container } = renderPage(TARGET_ENTRY, [muirWoods, completedHike]);
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(cardButton(container, completedHike.id));
    fireEvent.click(addButton('Add to "Big Sur"'));
    await settled(() =>
      expect(toast()).toHaveTextContent('"Big Sur" is now past — pick a different trip.'),
    );

    // It stops at the first refusal.
    expect(trips.addActivityToTrip).toHaveBeenCalledTimes(1);
    expect(path()).toBe('/');
    expect(screen.queryByText(/Adding to/)).not.toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(addButton('Add to trip')).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(toast()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast()).not.toBeInTheDocument();
  });

  it.each([
    [new Error('Network down'), 'Network down'],
    ['nope', 'Failed to add to trip.'],
  ])('shows a failed add (%s) for three seconds', async (failure, message) => {
    trips.addActivityToTrip.mockRejectedValue(failure);
    const { container } = renderPage(TARGET_ENTRY);
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(addButton('Add to "Big Sur"'));
    await settled(() => expect(toast()).toHaveTextContent(message));
    expect(path()).toBe('/');
    expect(addButton('Add to "Big Sur"')).toBeEnabled();
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(toast()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast()).not.toBeInTheDocument();
  });
});

describe('Curated Adventures — the trip dialog and the per-card control', () => {
  it('opens the dialog with the selection, and closes it', () => {
    const { container } = renderPage('/', [muirWoods, completedHike]);
    fireEvent.click(addButton(/Select for trip/));
    fireEvent.click(cardButton(container, completedHike.id));
    fireEvent.click(cardButton(container, muirWoods.id));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(addButton('Add to trip'));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      `dialog for ${completedHike.id},${muirWoods.id}`,
    );
    expect(trips.addActivityToTrip).not.toHaveBeenCalled();

    fireEvent.click(addButton('dialog close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Closing keeps the selection.
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('reports what the dialog added and ends the selection', () => {
    const { container } = renderPage();
    fireEvent.click(addButton(/Select for trip/));
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(addButton('Add to trip'));
    fireEvent.click(addButton('dialog added some'));

    expect(toast()).toHaveTextContent('Added 2 to "Tahoe" · 1 already on trip');
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(addButton(/Select for trip/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(toast()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast()).not.toBeInTheDocument();
  });

  it('reports a dialog add of nothing as an empty notice', () => {
    const { container } = renderPage();
    fireEvent.click(addButton(/Select for trip/));
    fireEvent.click(cardButton(container, muirWoods.id));
    fireEvent.click(addButton('Add to trip'));
    fireEvent.click(addButton('dialog added none'));
    expect(toast()).not.toBeInTheDocument();
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('shows what the per-card control added for three seconds', () => {
    renderPage();
    fireEvent.click(addButton(/Select for trip/));
    fireEvent.click(addButton(`dropdown ${muirWoods.id}`));
    expect(toast()).toHaveTextContent(`dropdown added ${muirWoods.id}`);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(toast()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast()).not.toBeInTheDocument();
  });
});
