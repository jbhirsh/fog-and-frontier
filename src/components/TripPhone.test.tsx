import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { completedHike, muirWoods } from '../test/fixtures';
import type { Trip, TripActivity, TripMember } from '../lib/userTrips';
import { TripPhone } from './TripPhone';

// A trip's page on a phone (#294).

function stop(over: Partial<TripActivity> & { id: string }): TripActivity {
  return {
    trip_id: 'trip-1',
    activity_id: over.id,
    added_by_email: 'jess@example.com',
    added_at: 0,
    day_index: 0,
    start_time: '09:00',
    display_order: 0,
    snapshot: { ...muirWoods, id: over.id, name: `Place ${over.id}` },
    ...over,
  };
}

function member(email: string, display_name: string | null = null): TripMember {
  return { email, display_name, added_by_email: email, added_at: 0, is_creator: false };
}

const TRIP: Trip = {
  id: 'trip-1',
  creator_email: 'jess@example.com',
  title: 'Coast Weekend',
  description: null,
  start_date: '2026-04-11',
  end_date: '2026-04-12',
  cover_image_url: null,
  status: 'planning',
  created_at: 0,
  marked_past_at: null,
  activities: [
    stop({ id: 'late', start_time: '18:00', snapshot: { ...completedHike, name: 'Sunset Point' } }),
    stop({ id: 'early', start_time: '08:30' }),
    stop({ id: 'noon', start_time: '13:15', snapshot: null }),
    stop({ id: 'sunday', day_index: 1, start_time: '10:00' }),
    stop({ id: 'loose', day_index: null, start_time: null }),
  ],
  members: [member('jess@example.com', 'Jess'), member('tarun@example.com')],
  invites: [],
  votes: [],
};

function show(over: Partial<Parameters<typeof TripPhone>[0]> = {}) {
  const props = {
    trip: TRIP,
    isPast: false,
    isVoting: false,
    menu: <button type="button">More trip actions</button>,
    members: <p>the members strip</p>,
    onInvite: vi.fn(),
    ideas: <section>the ideas</section>,
    ideasCount: 1,
    map: <p>the map</p>,
    onOpen: vi.fn(),
    onSchedule: vi.fn(),
    onMove: vi.fn(),
    onEditTime: vi.fn(),
    onUnschedule: vi.fn(),
    onRemove: vi.fn(),
    onBrowse: vi.fn(),
    busy: false,
    ...over,
  };
  const view = render(
    <MemoryRouter>
      <TripPhone {...props} />
    </MemoryRouter>,
  );
  return { props, view };
}

const rows = () =>
  within(screen.getByRole('region', { name: 'Plan' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('a trip’s page on a phone (#294)', () => {
  it('heads it with the way back, its name, dates and stage, and its menu', () => {
    show();
    expect(screen.getByRole('link', { name: /Trips/ })).toHaveAttribute('href', '/trips');
    expect(screen.getByRole('heading', { level: 1, name: 'Coast Weekend' })).toBeInTheDocument();
    expect(screen.getByText(/· Planning$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More trip actions' })).toBeInTheDocument();
  });

  it('marks the page while it’s up, so the brand’s bar steps aside', () => {
    const { view } = show();
    expect(document.documentElement).toHaveAttribute('data-own-header');
    view.unmount();
    expect(document.documentElement).not.toHaveAttribute('data-own-header');
  });

  it('says a voting or past trip’s stage', () => {
    show({ isVoting: true });
    expect(screen.getByText(/· Voting$/)).toBeInTheDocument();
    show({ isPast: true });
    expect(screen.getByText(/· Past$/)).toBeInTheDocument();
  });

  it('says when a past trip ended, once marked so', () => {
    show({ isPast: true, trip: { ...TRIP, marked_past_at: Date.UTC(2026, 10, 9, 12) } });
    expect(screen.getByText(/· Past · ended Nov 9$/)).toBeInTheDocument();
  });

  it('shows the trip’s description under its dates, and nothing without one', () => {
    show({ trip: { ...TRIP, description: 'Tide pools first, then the lighthouse.' } });
    expect(screen.getByText('Tide pools first, then the lighthouse.')).toBeInTheDocument();
    cleanup();
    const { view } = show();
    expect(view.container.querySelector('.whitespace-pre-line')).toBeNull();
  });

  it('shows the members as initials, opening the list of them, and invites', async () => {
    const { props } = show();
    const avatars = screen.getByRole('button', { name: 'Members: Jess, Tarun' });
    expect(avatars).toHaveTextContent('JT');
    await userEvent.click(avatars);
    const dialog = screen.getByRole('dialog', { name: 'Members' });
    expect(within(dialog).getByText('the members strip')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Invite/ }));
    expect(props.onInvite).toHaveBeenCalledOnce();
  });

  it('counts the members past three', () => {
    show({
      trip: {
        ...TRIP,
        members: ['a', 'b', 'c', 'd', 'e'].map((x) => member(`${x}@example.com`, x)),
      },
    });
    expect(screen.getByRole('button', { name: 'Members: a, b, c, d, e' })).toHaveTextContent(
      'ABC+2',
    );
  });

  it('switches between the plan, the ideas with their count, and the map', async () => {
    show({ ideasCount: 4 });
    const show_ = within(screen.getByRole('group', { name: 'Show' }));
    expect(show_.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(show_.getByRole('button', { name: 'Ideas · 4' }));
    expect(screen.getByText('the ideas')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Plan' })).not.toBeInTheDocument();
    await userEvent.click(show_.getByRole('button', { name: 'Map' }));
    expect(screen.getByText('the map')).toBeInTheDocument();
    expect(show_.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens a voting trip on its ideas, its plan saying it waits on the vote', async () => {
    show({ isVoting: true });
    expect(screen.getByText('the ideas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByText(/the plan comes once the trip creator finalizes voting/)).toBeVisible();
  });

  it('goes to the plan once voting closes', () => {
    const { props, view } = show({ isVoting: true });
    view.rerender(
      <MemoryRouter>
        <TripPhone {...props} isVoting={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'Plan' })).toBeInTheDocument();
  });

  it('shows a day at a time, each by its date and how many places it holds', async () => {
    show();
    const days = within(screen.getByRole('group', { name: 'Day' }));
    const sat = days.getByRole('button', { name: 'Sat 11 3 places' });
    expect(sat).toHaveAttribute('aria-pressed', 'true');
    expect(rows()).toEqual([
      'Morning Place early Hike · Half Daydrag_indicator',
      'Afternoon (deleted activity) drag_indicator',
      'Evening Sunset Point Scenic · 2-3 Hoursdrag_indicator',
      'addAdd a place to Saturday',
    ]);
    await userEvent.click(days.getByRole('button', { name: 'Sun 12 1 place' }));
    expect(rows()).toEqual([
      'Morning Place sunday Hike · Half Daydrag_indicator',
      'addAdd a place to Sunday',
    ]);
  });

  it('says a day with nothing on it has nothing yet', () => {
    show({ trip: { ...TRIP, activities: [] } });
    expect(screen.getByRole('button', { name: 'Sun 12 Nothing yet' })).toBeInTheDocument();
  });

  it('opens a place from its row, but not one deleted from the catalog', async () => {
    const { props } = show();
    await userEvent.click(
      screen.getByRole('button', { name: 'Morning Place early Hike · Half Day' }),
    );
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'early' }));
    expect(screen.getByRole('button', { name: 'Afternoon (deleted activity)' })).toBeDisabled();
  });

  describe('a place’s handle', () => {
    it('moves it earlier or later in the day', async () => {
      const { props } = show();
      await userEvent.click(screen.getByRole('button', { name: 'Move or change Sunset Point' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Sunset Point' }));
      expect(screen.getByRole('dialog', { name: 'Sunset Point' })).toHaveFocus();
      expect(dialog.getByRole('button', { name: /Later in the day/ })).toBeDisabled();
      await userEvent.click(dialog.getByRole('button', { name: /Earlier in the day/ }));
      expect(props.onMove).toHaveBeenCalledWith([
        { id: 'late', start_time: '13:15' },
        { id: 'noon', start_time: '18:00' },
      ]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Focus goes back to the handle it came from.
      expect(screen.getByRole('button', { name: 'Move or change Sunset Point' })).toHaveFocus();
    });

    it('can’t move the day’s first earlier', async () => {
      const { props } = show();
      await userEvent.click(screen.getByRole('button', { name: 'Move or change Place early' }));
      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByRole('button', { name: /Earlier/ })).toBeDisabled();
      await userEvent.click(dialog.getByRole('button', { name: /Later in the day/ }));
      expect(props.onMove).toHaveBeenCalledWith([
        { id: 'early', start_time: '13:15' },
        { id: 'noon', start_time: '08:30' },
      ]);
    });

    it.each([
      ['Change day or time…', 'onEditTime'],
      ['Take off the plan', 'onUnschedule'],
      ['Remove from trip', 'onRemove'],
    ] as const)('offers %s', async (label, handler) => {
      const { props } = show();
      await userEvent.click(screen.getByRole('button', { name: 'Move or change Place early' }));
      await userEvent.click(screen.getByRole('button', { name: label }));
      expect(props[handler]).toHaveBeenCalledWith(expect.objectContaining({ id: 'early' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('moves the place as the trip is now, after it reloads under the sheet', async () => {
      const { props, view } = show();
      await userEvent.click(screen.getByRole('button', { name: 'Move or change Place early' }));
      // The same trip, every place a new object, as a reload brings.
      const reloaded = { ...TRIP, activities: TRIP.activities.map((a) => ({ ...a })) };
      view.rerender(
        <MemoryRouter>
          <TripPhone {...props} trip={reloaded} />
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole('button', { name: /Later in the day/ }));
      expect(props.onMove).toHaveBeenCalledWith([
        { id: 'early', start_time: '13:15' },
        { id: 'noon', start_time: '08:30' },
      ]);
    });

    it('closes when its place leaves the day', async () => {
      const { props, view } = show();
      await userEvent.click(screen.getByRole('button', { name: 'Move or change Place early' }));
      const gone = { ...TRIP, activities: TRIP.activities.filter((a) => a.id !== 'early') };
      view.rerender(
        <MemoryRouter>
          <TripPhone {...props} trip={gone} />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes without a change from its backdrop', async () => {
      const { props } = show();
      await userEvent.click(screen.getByRole('button', { name: 'Move or change Place early' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(props.onMove).not.toHaveBeenCalled();
    });
  });

  it('adds one of the trip’s unplanned places to the day', async () => {
    const { props } = show();
    await userEvent.click(screen.getByRole('button', { name: /Add a place to Saturday/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add a place to Saturday' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Place loose' }));
    expect(props.onSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'loose' }), 0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes to the catalog for another', async () => {
    const { props } = show();
    await userEvent.click(screen.getByRole('button', { name: /Add a place to Saturday/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Find another in the catalog' }));
    expect(props.onBrowse).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes straight to the catalog when every place is planned', async () => {
    const { props } = show({
      trip: { ...TRIP, activities: TRIP.activities.filter((a) => a.day_index !== null) },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add a place to Saturday/ }));
    expect(props.onBrowse).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('holds the handles while a change saves, so a move isn’t lost', () => {
    show({ busy: true });
    for (const handle of screen.getAllByRole('button', { name: /^Move or change/ })) {
      expect(handle).toBeDisabled();
    }
  });

  it('shows what went wrong under the header', () => {
    show({ notice: <p>That didn’t go through.</p> });
    const notice = screen.getByText('That didn’t go through.');
    expect(screen.getByRole('group', { name: 'Show' }).compareDocumentPosition(notice)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('leaves a past trip’s plan as it was: no handles, nothing to add', () => {
    show({ isPast: true });
    expect(screen.queryByRole('button', { name: /^Move or change/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a place/ })).not.toBeInTheDocument();
  });

  it('names an unplanned place without a snapshot as an activity', async () => {
    show({
      trip: {
        ...TRIP,
        activities: [...TRIP.activities, stop({ id: 'gone', day_index: null, snapshot: null })],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add a place to Saturday/ }));
    expect(screen.getByRole('button', { name: '(activity)' })).toBeInTheDocument();
  });

  it('keeps the chosen day within a trip that got shorter', async () => {
    const { props, view } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Sun 12 1 place' }));
    view.rerender(
      <MemoryRouter>
        <TripPhone {...props} trip={{ ...TRIP, end_date: '2026-04-11' }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Sat 11 3 places' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
