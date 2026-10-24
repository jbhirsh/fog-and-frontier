import { describe, expect, it } from 'vitest';
import { render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { Activity } from '../data/types';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

// The Contributors filter (#9): signed-in only, URL-synced as ?contributors=,
// matching an activity any chosen account added.

const TARUN = 'tarun@example.com';
const JESS = 'jess@example.com';

const SIGNED_IN: AuthState = {
  isLoaded: true,
  email: 'editor@example.com',
  getToken: () => Promise.resolve(null),
};
const SIGNED_OUT: AuthState = { ...SIGNED_IN, email: null };

const CREDITED: Activity[] = [
  { ...muirWoods, contributors: [TARUN] },
  { ...completedHike, contributors: [JESS] },
  { ...dogFriendlyTidepools, contributors: [TARUN, JESS] },
];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderAs(auth: AuthState, path = '/', activities: Activity[] = CREDITED) {
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <CuratedAdventures />
        <Search />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities },
  );
}

function shown() {
  return ['Test Muir Woods', 'Test Completed Hike', 'Test Tide Pools'].filter(
    (name) => screen.queryByText(name) !== null,
  );
}

describe('Curated Adventures — contributors filter (#9)', () => {
  it('filters to the accounts in ?contributors=, any of them', () => {
    renderAs(SIGNED_IN, `/?contributors=${encodeURIComponent(JESS)}`);
    expect(shown()).toEqual(['Test Completed Hike', 'Test Tide Pools']);
    expect(
      screen.getByRole('button', { name: 'Remove contributor filter: Jess' }),
    ).toBeInTheDocument();
  });

  it('picks a contributor into the URL, and its chip takes them off again', async () => {
    renderAs(SIGNED_IN);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Contributed by' }), TARUN);
    expect(screen.getByTestId('search')).toHaveTextContent(
      `?contributors=${encodeURIComponent(TARUN)}`,
    );
    expect(shown()).toEqual(['Test Muir Woods', 'Test Tide Pools']);

    await userEvent.click(screen.getByRole('button', { name: 'Remove contributor filter: Tarun' }));
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(shown()).toHaveLength(3);
  });

  it('is not rendered for a signed-out visitor, and their link filters nothing', () => {
    // A shared ?contributors= link: the server sends a signed-out visitor no
    // contributors, so honouring it would empty the list.
    renderAs(SIGNED_OUT, `/?contributors=${encodeURIComponent(TARUN)}`, [
      muirWoods,
      completedHike,
      dogFriendlyTidepools,
    ]);
    expect(screen.queryByRole('combobox', { name: 'Contributed by' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /contributor filter/ })).not.toBeInTheDocument();
    expect(shown()).toHaveLength(3);
    // The link is left as it was, for when they sign in.
    expect(screen.getByTestId('search')).toHaveTextContent(
      `?contributors=${encodeURIComponent(TARUN)}`,
    );
  });

  it('offers no picker when nothing is credited', () => {
    renderAs(SIGNED_IN, '/', [muirWoods]);
    expect(screen.queryByRole('combobox', { name: 'Contributed by' })).not.toBeInTheDocument();
  });
});
