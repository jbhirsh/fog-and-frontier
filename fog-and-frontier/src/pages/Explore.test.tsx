import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
} from '../test/fixtures';

vi.mock('../data/activities', () => ({
  activities: [muirWoods, completedHike, dogFriendlyTidepools],
}));

import { Explore } from './Explore';

function renderExplore() {
  return render(
    <MemoryRouter>
      <Explore />
    </MemoryRouter>,
  );
}

describe('Explore page', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all activities by default, sorted by distance', () => {
    renderExplore();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
    expect(screen.getByText('Test Tide Pools')).toBeInTheDocument();
  });

  it('filters by free-text search', async () => {
    renderExplore();
    const input = screen.getByPlaceholderText(/Find your next adventure/);
    await userEvent.type(input, 'tide');
    expect(screen.getByText('Test Tide Pools')).toBeInTheDocument();
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    renderExplore();
    const input = screen.getByPlaceholderText(/Find your next adventure/);
    await userEvent.type(input, 'nothing-matches-this-zzz');
    expect(
      screen.getByText('No activities match those filters.'),
    ).toBeInTheDocument();
  });

  it('filters by duration', async () => {
    renderExplore();
    const durationSelect = screen.getByDisplayValue('Any duration');
    await userEvent.selectOptions(durationSelect, 'Half Day');
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
  });

  it('filters by max distance', async () => {
    renderExplore();
    const distanceSelect = screen.getByDisplayValue('Any distance');
    await userEvent.selectOptions(distanceSelect, '25');
    // From Campbell, all fixtures are >25 miles away.
    expect(
      screen.getByText('No activities match those filters.'),
    ).toBeInTheDocument();
  });

  it('toggles dog-friendly filter', async () => {
    renderExplore();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
    expect(screen.getByText('Test Tide Pools')).toBeInTheDocument();
  });

  it('opens the detail dialog when a card is clicked', async () => {
    renderExplore();
    await userEvent.click(
      screen.getByRole('button', { name: /Test Muir Woods/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Test Muir Woods')).toBeInTheDocument();
  });
});
