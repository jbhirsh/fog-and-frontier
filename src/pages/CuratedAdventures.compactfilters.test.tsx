import { describe, expect, it } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { Activity } from '../data/types';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

// The phone's filters: one Filters button opening a sheet of them all, and a
// chip for each filter on. (CSS shows them only below md, which jsdom
// ignores, so they sit beside the wider screens' pickers here.)

const TARUN = 'tarun@example.com';

const SIGNED_IN: AuthState = {
  isLoaded: true,
  email: 'editor@example.com',
  getToken: () => Promise.resolve(null),
};
const SIGNED_OUT: AuthState = { ...SIGNED_IN, email: null };

const ACTIVITIES: Activity[] = [
  { ...muirWoods, contributors: [TARUN], parkType: 'national' },
  { ...completedHike, costTier: 'free' },
  dogFriendlyTidepools,
];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderAs(auth: AuthState, path = '/') {
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <CuratedAdventures />
        <Search />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: ACTIVITIES },
  );
}

function shown() {
  return ['Test Muir Woods', 'Test Completed Hike', 'Test Tide Pools'].filter(
    (name) => screen.queryByText(name) !== null,
  );
}

async function openSheet() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  return within(screen.getByRole('dialog', { name: 'Filters' }));
}

describe('Curated Adventures — the phone’s Filters sheet', () => {
  it('filters the list as the sheet changes, counting what’s left', async () => {
    renderAs(SIGNED_OUT);
    const sheet = await openSheet();
    await userEvent.click(sheet.getByRole('checkbox', { name: 'Dog friendly' }));
    expect(shown()).toEqual(['Test Completed Hike', 'Test Tide Pools']);
    expect(sheet.getByRole('button', { name: 'Show 2 places' })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole('button', { name: 'Show 2 places' }));
    expect(screen.getByRole('button', { name: 'Filters, 1 on' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove filter: Dog friendly' })).toBeInTheDocument();
  });

  it('writes Completed only and contributors to the URL, and clears both at once', async () => {
    renderAs(SIGNED_IN);
    const sheet = await openSheet();
    await userEvent.click(sheet.getByRole('checkbox', { name: 'Completed only' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?completed=1');
    await userEvent.click(
      within(sheet.getByRole('group', { name: 'Added by' })).getByRole('button', {
        name: /Tarun/,
      }),
    );
    expect(screen.getByTestId('search')).toHaveTextContent(
      `?completed=1&contributors=${encodeURIComponent(TARUN)}`,
    );
    await userEvent.click(sheet.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(shown()).toHaveLength(3);
  });

  it('shows a filter from the link as a chip that takes it off', async () => {
    renderAs(SIGNED_IN, '/?completed=1');
    expect(shown()).toEqual(['Test Completed Hike']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Completed only' }));
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(shown()).toHaveLength(3);
  });

  it('sets the in-memory filters too', async () => {
    renderAs(SIGNED_OUT);
    const sheet = await openSheet();
    await userEvent.click(
      within(sheet.getByRole('group', { name: 'Category' })).getByRole('button', {
        name: 'Scenic',
      }),
    );
    expect(shown()).toEqual(['Test Completed Hike', 'Test Tide Pools']);
    await userEvent.click(
      within(sheet.getByRole('group', { name: 'How long' })).getByRole('button', {
        name: '1-2 Hours',
      }),
    );
    expect(shown()).toEqual(['Test Tide Pools']);
    await userEvent.click(sheet.getByRole('button', { name: 'Clear all' }));
    expect(shown()).toHaveLength(3);
  });

  it('offers a signed-out visitor no contributors', async () => {
    renderAs(SIGNED_OUT);
    const sheet = await openSheet();
    expect(sheet.queryByRole('group', { name: 'Added by' })).not.toBeInTheDocument();
  });

  it('sets the distance, park type and Free too', async () => {
    renderAs(SIGNED_OUT);
    const sheet = await openSheet();
    await userEvent.click(
      within(sheet.getByRole('group', { name: 'Park type' })).getByRole('button', {
        name: 'National park',
      }),
    );
    expect(shown()).toEqual(['Test Muir Woods']);
    await userEvent.click(sheet.getByRole('button', { name: 'Clear all' }));
    await userEvent.click(sheet.getByRole('checkbox', { name: 'Free' }));
    expect(shown()).toEqual(['Test Completed Hike']);
    await userEvent.click(sheet.getByRole('button', { name: 'Clear all' }));
    // From San Jose: the tide pools are under 50 miles, Mill Valley over.
    await userEvent.click(
      within(sheet.getByRole('group', { name: 'How far' })).getByRole('button', {
        name: '50 mi',
      }),
    );
    expect(shown()).toEqual(['Test Tide Pools']);
    expect(screen.getByRole('button', { name: 'Remove filter: Within 50 mi' })).toBeInTheDocument();
  });
});
