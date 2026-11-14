import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TripListItem } from '../lib/userTrips';
import { tripListItem } from '../test/trips';

const state = vi.hoisted(() => ({
  owner: { isOwner: false, isLoaded: true, email: null as string | null },
  list: { trips: [] as TripListItem[], isLoading: false, error: null as Error | null },
}));
vi.mock('../lib/useOwner', () => ({ useOwner: () => state.owner }));
vi.mock('../lib/userTrips', () => ({ useTripsList: () => state.list }));

import { Trips } from './Trips';
import { getIcon, queryIcon } from '../test/icons';

const OWNER = { isOwner: true, isLoaded: true, email: 'owner@example.com' };
const MEMBER = { isOwner: false, isLoaded: true, email: 'editor@example.com' };

function renderTrips() {
  return render(
    <MemoryRouter>
      <Trips />
    </MemoryRouter>,
  );
}

const newTripLinks = () => screen.queryAllByRole('link', { name: /New trip/ });

beforeEach(() => {
  state.owner = MEMBER;
  state.list = { trips: [], isLoading: false, error: null };
});

describe('Trips', () => {
  it('waits for auth before showing anything', () => {
    state.owner = { isOwner: false, isLoaded: false, email: null };
    renderTrips();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in', () => {
    state.owner = { isOwner: false, isLoaded: true, email: null };
    state.list.trips = [tripListItem()];
    renderTrips();
    expect(screen.getByRole('heading', { name: 'Trips' })).toBeInTheDocument();
    expect(screen.getByText(/Sign in to see trips/)).toBeInTheDocument();
    expect(screen.queryByText('Big Sur')).not.toBeInTheDocument();
    expect(newTripLinks()).toHaveLength(0);
  });

  it('shows loading, then an error, while signed in', () => {
    state.list = { trips: [tripListItem()], isLoading: true, error: null };
    const { rerender } = renderTrips();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Big Sur')).not.toBeInTheDocument();

    state.list = { trips: [tripListItem()], isLoading: false, error: new Error('boom') };
    rerender(
      <MemoryRouter>
        <Trips />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Couldn't load trips/)).toBeInTheDocument();
    expect(screen.queryByText('Big Sur')).not.toBeInTheDocument();
  });

  it('offers an owner with no trips two ways to plan one', () => {
    state.owner = OWNER;
    renderTrips();
    expect(screen.getByText('No trips yet — plan one.')).toBeInTheDocument();
    const links = newTripLinks();
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/trips/new');
  });

  it('tells a member with no trips they come by invitation, with no New trip', () => {
    renderTrips();
    expect(screen.getByText(/once you're invited to one/)).toBeInTheDocument();
    expect(screen.queryByText('No trips yet — plan one.')).not.toBeInTheDocument();
    expect(newTripLinks()).toHaveLength(0);
  });

  it('lists each trip as a card linking to it, with its dates, counts and status', () => {
    state.owner = OWNER;
    state.list.trips = [
      tripListItem({
        id: 't1',
        title: 'Big Sur',
        cover_image_url: 'https://example.com/sur.jpg',
        scheduled_count: 3,
        unscheduled_count: 2,
      }),
      tripListItem({ id: 't2', title: 'Tahoe', status: 'voting' }),
      tripListItem({
        id: 't3',
        title: 'Yosemite',
        status: 'past',
        // Noon local time: the card shows the day in the local zone.
        marked_past_at: new Date(2026, 4, 9, 12).getTime(),
      }),
      tripListItem({ id: 't4', title: 'Shasta', status: 'past', marked_past_at: null }),
    ];
    renderTrips();
    // Only the header's New trip, not the empty state's.
    expect(newTripLinks()).toHaveLength(1);

    const card = (title: string) =>
      screen.getByRole('link', { name: (name) => name.includes(title) });
    const sur = card('Big Sur');
    expect(sur).toHaveAttribute('href', '/trips/t1');
    // alt="": the cover is decoration, so it has no img role.
    expect(sur.querySelector('img')).toHaveAttribute('src', 'https://example.com/sur.jpg');
    expect(sur).toHaveTextContent('Mar 3 – Mar 5, 2026');
    expect(sur).toHaveTextContent('3 scheduled');
    expect(sur).toHaveTextContent('2 unscheduled');
    expect(sur).toHaveTextContent('Planning');
    expect(queryIcon('landscape', sur)).toBeNull();

    const tahoe = card('Tahoe');
    expect(tahoe).toHaveAttribute('href', '/trips/t2');
    expect(tahoe).toHaveTextContent('Voting');
    expect(tahoe).not.toHaveTextContent('Planning');
    getIcon('landscape', tahoe);
    expect(tahoe.querySelector('img')).toBeNull();

    expect(card('Yosemite')).toHaveTextContent('Past · May 9');
    expect(card('Shasta')).toHaveTextContent(/Past\s*Shasta/);
    expect(card('Shasta')).not.toHaveTextContent('·');
  });
});
