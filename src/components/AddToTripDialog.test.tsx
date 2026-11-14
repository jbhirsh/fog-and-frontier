import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TripListItem } from '../lib/userTrips';
import { RouteStateProbe } from '../test/RouteStateProbe';
import { tripListItem } from '../test/trips';

const trips = vi.hoisted(() => ({
  list: { trips: [] as TripListItem[], isLoading: false },
  add: vi.fn(),
}));
vi.mock('../lib/userTrips', () => ({
  useTripsList: () => trips.list,
  addActivityToTrip: trips.add,
}));

import { AddToTripDialog } from './AddToTripDialog';

const bigSur = tripListItem({ id: 'trip-1', title: 'Big Sur' });
const voting = tripListItem({
  id: 'trip-2',
  title: 'Tahoe',
  status: 'voting',
  start_date: '2026-07-01',
  end_date: '2026-07-04',
});

const added = { alreadyOnTrip: false, tripPast: false };
const already = { alreadyOnTrip: true, tripPast: false };

function renderDialog(
  activityIds = ['a1', 'a2'],
  onAdded?: Parameters<typeof AddToTripDialog>[0]['onAdded'],
) {
  const onClose = vi.fn();
  const { unmount } = render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <AddToTripDialog activityIds={activityIds} onClose={onClose} onAdded={onAdded} />
            </>
          }
        />
        <Route path="/trips/new" element={<RouteStateProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose, unmount };
}

const tripButton = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  trips.list = { trips: [bigSur, voting], isLoading: false };
  trips.add.mockReset();
});

describe('AddToTripDialog', () => {
  it('opens focused, without scrolling, counting the activities', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Add to trip' });
    expect(dialog).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
    expect(screen.getByRole('heading', { name: 'Add 2 activities to a trip' })).toBeInTheDocument();
    // Neither the dialog nor its backdrop is a Tab stop of its own.
    expect(dialog.tabIndex).toBeLessThan(0);
    expect(screen.getByRole('button', { name: 'Close dialog' }).tabIndex).toBeLessThan(0);
    // No error until something fails: neither of the messages the dialog says.
    expect(screen.queryByText(/Failed to add|marked past/)).not.toBeInTheDocument();
  });

  it('keeps Tab inside, wrapping at either end', async () => {
    renderDialog();
    await userEvent.tab({ shift: true });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /New trip from selection/ })).toHaveFocus();
  });

  it('hands focus back to its opener when it closes', () => {
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    const { unmount } = renderDialog();
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('says "activity" for one', () => {
    renderDialog(['a1']);
    expect(screen.getByRole('heading', { name: 'Add 1 activity to a trip' })).toBeInTheDocument();
  });

  it('offers every trip not yet past, with its dates', () => {
    trips.list.trips = [
      bigSur,
      tripListItem({ id: 'p', title: 'Old trip', status: 'past' }),
      voting,
    ];
    renderDialog();
    expect(tripButton(/Big Sur/)).toHaveTextContent('2026-03-03 – 2026-03-05');
    expect(tripButton(/Tahoe/)).toHaveTextContent('2026-07-01 – 2026-07-04');
    expect(screen.queryByText('Old trip')).not.toBeInTheDocument();
    expect(screen.queryByText('No active trips yet.')).not.toBeInTheDocument();
  });

  it('says when trips are loading', () => {
    trips.list = { trips: [bigSur], isLoading: true };
    renderDialog();
    expect(screen.getByText('Loading trips…')).toBeInTheDocument();
    expect(screen.queryByText('Big Sur')).not.toBeInTheDocument();
  });

  it('says when there is no active trip', () => {
    trips.list.trips = [tripListItem({ status: 'past' })];
    renderDialog();
    expect(screen.getByText('No active trips yet.')).toBeInTheDocument();
    expect(screen.queryByText('Loading trips…')).not.toBeInTheDocument();
  });

  it('closes on Cancel and on the backdrop', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(trips.add).not.toHaveBeenCalled();
  });

  it('starts a new trip pre-loaded with the selection', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /New trip from selection/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('route-state')).toHaveTextContent(
      '/trips/new {"initial_activity_ids":["a1","a2"]}',
    );
  });

  it('adds each activity in turn, counting those already on the trip, then closes', async () => {
    trips.add.mockResolvedValueOnce(added).mockResolvedValueOnce(already);
    const onAdded = vi.fn();
    const { onClose } = renderDialog(['a1', 'a2', 'a3'], onAdded);
    trips.add.mockResolvedValueOnce(added);
    await userEvent.click(tripButton(/Tahoe/));
    expect(trips.add.mock.calls).toEqual([
      ['trip-2', 'a1'],
      ['trip-2', 'a2'],
      ['trip-2', 'a3'],
    ]);
    expect(onAdded).toHaveBeenCalledExactlyOnceWith(voting, 2, 1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes after adding even with no onAdded', async () => {
    trips.add.mockResolvedValue(already);
    const { onClose } = renderDialog(['a1']);
    await userEvent.click(tripButton(/Big Sur/));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stops at a trip just marked past, saying so, and stays open', async () => {
    trips.add
      .mockResolvedValueOnce(added)
      .mockResolvedValueOnce({ alreadyOnTrip: false, tripPast: true });
    const onAdded = vi.fn();
    const { onClose } = renderDialog(['a1', 'a2', 'a3'], onAdded);
    await userEvent.click(tripButton(/Big Sur/));
    expect(
      screen.getByText('"Big Sur" was just marked past — refresh and pick a different trip.'),
    ).toBeInTheDocument();
    expect(trips.add).toHaveBeenCalledTimes(2);
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(tripButton(/Big Sur/)).toBeEnabled();
  });

  it("shows the error's message, or a fallback, and clears it on the next try", async () => {
    trips.add.mockRejectedValueOnce(new Error('Not a member'));
    trips.add.mockRejectedValueOnce('nope');
    trips.add.mockReturnValueOnce(new Promise(() => {}));
    const { onClose } = renderDialog(['a1']);
    await userEvent.click(tripButton(/Big Sur/));
    expect(screen.getByText('Not a member')).toBeInTheDocument();
    expect(tripButton(/Big Sur/)).toBeEnabled();

    await userEvent.click(tripButton(/Big Sur/));
    expect(screen.getByText('Failed to add.')).toBeInTheDocument();
    expect(screen.queryByText('Not a member')).not.toBeInTheDocument();

    await userEvent.click(tripButton(/Big Sur/));
    expect(screen.queryByText('Failed to add.')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables its choices while an add is in flight, and adds once', async () => {
    let finish: (v: typeof added) => void = () => {};
    trips.add.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onAdded = vi.fn();
    renderDialog(['a1'], onAdded);
    await userEvent.click(tripButton(/Big Sur/));
    expect(tripButton(/Big Sur/)).toBeDisabled();
    expect(tripButton(/Tahoe/)).toBeDisabled();
    expect(screen.getByRole('button', { name: /New trip from selection/ })).toBeDisabled();
    finish(added);
    await waitFor(() => expect(onAdded).toHaveBeenCalledExactlyOnceWith(bigSur, 1, 0));
    expect(trips.add).toHaveBeenCalledTimes(1);
  });
});
