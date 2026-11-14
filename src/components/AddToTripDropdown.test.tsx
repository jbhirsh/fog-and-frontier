import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TripListItem } from '../lib/userTrips';
import { RouteStateProbe } from '../test/RouteStateProbe';
import { tripListItem } from '../test/trips';

const trips = vi.hoisted(() => ({
  list: { trips: [] as TripListItem[], isLoading: false, error: null as Error | null },
  add: vi.fn(),
  listCalls: 0,
}));
vi.mock('../lib/userTrips', () => ({
  useTripsList: () => {
    trips.listCalls++;
    return trips.list;
  },
  addActivityToTrip: trips.add,
}));

import { AddToTripDropdown } from './AddToTripDropdown';
import { getIcon, queryIcon } from '../test/icons';

const bigSur = tripListItem({ id: 'trip-1', title: 'Big Sur' });
const tahoe = tripListItem({
  id: 'trip-2',
  title: 'Tahoe',
  start_date: '2026-07-01',
  end_date: '2026-07-04',
});

// A click that bubbles past the dropdown, as one would to a card's handler:
// listened for during each test only.
const outside = vi.fn();
beforeEach(() => {
  outside.mockClear();
  document.addEventListener('click', outside);
});
afterEach(() => {
  document.removeEventListener('click', outside);
});

function renderDropdown(onAdded?: (message: string) => void) {
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <AddToTripDropdown activityId="act-1" onAdded={onAdded} />
              <p>elsewhere</p>
            </>
          }
        />
        <Route path="/trips/new" element={<RouteStateProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { outside };
}

const toggle = () => screen.getByRole('button', { name: 'Add to trip' });

beforeEach(() => {
  trips.list = { trips: [bigSur, tahoe], isLoading: false, error: null };
  trips.add.mockReset();
  trips.listCalls = 0;
});

describe('AddToTripDropdown', () => {
  it('opens and closes on its toggle without reaching the card, fetching only when open', async () => {
    const { outside } = renderDropdown();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    getIcon('add_circle', toggle());
    expect(queryIcon('close', toggle())).toBeNull();
    expect(screen.queryByText('New trip from this')).not.toBeInTheDocument();
    expect(trips.listCalls).toBe(0);

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    getIcon('close', toggle());
    expect(queryIcon('add_circle', toggle())).toBeNull();
    expect(screen.getByText('New trip from this')).toBeInTheDocument();
    expect(trips.listCalls).toBeGreaterThan(0);

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('New trip from this')).not.toBeInTheDocument();
    expect(outside).not.toHaveBeenCalled();
  });

  it('lists only planning trips with their dates', async () => {
    trips.list.trips = [
      bigSur,
      tripListItem({ id: 'v', title: 'Voting trip', status: 'voting' }),
      tripListItem({ id: 'p', title: 'Past trip', status: 'past' }),
      tahoe,
    ];
    renderDropdown();
    await userEvent.click(toggle());
    expect(screen.getByRole('button', { name: /Big Sur/ })).toHaveTextContent(
      '2026-03-03 – 2026-03-05',
    );
    expect(screen.getByRole('button', { name: /Tahoe/ })).toBeEnabled();
    expect(screen.queryByText('Voting trip')).not.toBeInTheDocument();
    expect(screen.queryByText('Past trip')).not.toBeInTheDocument();
    // No error until an add fails: neither of the messages the dropdown says.
    expect(screen.queryByText(/Failed to add|marked past/)).not.toBeInTheDocument();
  });

  it('says when trips are loading, failed or none are planning', async () => {
    trips.list = { trips: [bigSur], isLoading: true, error: null };
    renderDropdown();
    await userEvent.click(toggle());
    expect(screen.getByText('Loading trips…')).toBeInTheDocument();
    expect(screen.queryByText('Big Sur')).not.toBeInTheDocument();

    await userEvent.click(toggle());
    trips.list = { trips: [bigSur], isLoading: false, error: new Error('boom') };
    await userEvent.click(toggle());
    expect(screen.getByText("Couldn't load trips.")).toBeInTheDocument();
    expect(screen.queryByText('Big Sur')).not.toBeInTheDocument();

    await userEvent.click(toggle());
    trips.list = {
      trips: [tripListItem({ status: 'voting' })],
      isLoading: false,
      error: null,
    };
    await userEvent.click(toggle());
    expect(screen.getByText('No planning trips yet.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load trips.")).not.toBeInTheDocument();
    expect(screen.queryByText('Loading trips…')).not.toBeInTheDocument();
  });

  it('closes on Escape and on a click outside, but not on other keys or a click inside', async () => {
    trips.list = { trips: [], isLoading: true, error: null };
    renderDropdown();
    await userEvent.click(toggle());
    await userEvent.keyboard('a');
    await userEvent.click(screen.getByText('Loading trips…'));
    expect(screen.getByText('New trip from this')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('New trip from this')).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle());
    await userEvent.click(screen.getByText('elsewhere'));
    expect(screen.queryByText('New trip from this')).not.toBeInTheDocument();
  });

  it('listens for Escape and outside clicks only while open', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    renderDropdown();
    expect(add).not.toHaveBeenCalledWith('keydown', expect.any(Function));
    await userEvent.click(toggle());
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));
    await userEvent.click(toggle());
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    add.mockRestore();
    remove.mockRestore();
  });

  it("closes when another card's toggle is clicked, though that click stops", async () => {
    render(
      <MemoryRouter>
        <AddToTripDropdown activityId="act-1" />
        <AddToTripDropdown activityId="act-2" />
      </MemoryRouter>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Add to trip' });
    await userEvent.click(first);
    await userEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('New trip from this')).toHaveLength(1);
  });

  it('starts a new trip pre-loaded with the activity', async () => {
    const { outside } = renderDropdown();
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /New trip from this/ }));
    expect(screen.getByTestId('route-state')).toHaveTextContent(
      '/trips/new {"initial_activity_ids":["act-1"]}',
    );
    expect(outside).not.toHaveBeenCalled();
  });

  it('adds to a planning trip, reports it and closes', async () => {
    trips.add.mockResolvedValue({ alreadyOnTrip: false, tripPast: false });
    const onAdded = vi.fn();
    const { outside } = renderDropdown(onAdded);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /Tahoe/ }));
    expect(trips.add).toHaveBeenCalledExactlyOnceWith('trip-2', 'act-1');
    expect(onAdded).toHaveBeenCalledExactlyOnceWith('Added to "Tahoe"');
    expect(screen.queryByText('New trip from this')).not.toBeInTheDocument();
    expect(outside).not.toHaveBeenCalled();
  });

  it('says when the activity was already on the trip', async () => {
    trips.add.mockResolvedValue({ alreadyOnTrip: true, tripPast: false });
    const onAdded = vi.fn();
    renderDropdown(onAdded);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    expect(onAdded).toHaveBeenCalledExactlyOnceWith('Already on "Big Sur"');
  });

  it('closes after adding even with no onAdded', async () => {
    trips.add.mockResolvedValue({ alreadyOnTrip: false, tripPast: false });
    renderDropdown();
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    await waitFor(() => expect(screen.queryByText('New trip from this')).not.toBeInTheDocument());
  });

  it('stays open with a message when the trip was just marked past', async () => {
    trips.add.mockResolvedValue({ alreadyOnTrip: false, tripPast: true });
    const onAdded = vi.fn();
    renderDropdown(onAdded);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    expect(
      screen.getByText('"Big Sur" was just marked past — refresh to retry.'),
    ).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    // Not busy any more: the trips can be picked again.
    expect(screen.getByRole('button', { name: /Big Sur/ })).toBeEnabled();
  });

  it("shows the error's message, or a fallback, and clears it on the next try", async () => {
    trips.add.mockRejectedValueOnce(new Error('Not a member'));
    trips.add.mockRejectedValueOnce('nope');
    trips.add.mockReturnValueOnce(new Promise(() => {}));
    renderDropdown();
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    expect(screen.getByText('Not a member')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Big Sur/ })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    expect(screen.getByText('Failed to add.')).toBeInTheDocument();
    expect(screen.queryByText('Not a member')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    expect(screen.queryByText('Failed to add.')).not.toBeInTheDocument();
  });

  it('disables the trips while an add is in flight, and adds once', async () => {
    let finish: (v: { alreadyOnTrip: boolean; tripPast: boolean }) => void = () => {};
    trips.add.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onAdded = vi.fn();
    renderDropdown(onAdded);
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: /Big Sur/ }));
    expect(screen.getByRole('button', { name: /Big Sur/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Tahoe/ })).toBeDisabled();
    finish({ alreadyOnTrip: false, tripPast: false });
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(trips.add).toHaveBeenCalledTimes(1);
  });
});
