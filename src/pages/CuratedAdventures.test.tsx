import { describe, expect, it } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
} from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

function renderExplore(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CuratedAdventures />
    </MemoryRouter>,
    { activities: [muirWoods, completedHike, dogFriendlyTidepools] },
  );
}

describe('Curated Adventures page', () => {

  it('renders all activities by default, sorted by distance', () => {
    renderExplore();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
    expect(screen.getByText('Test Tide Pools')).toBeInTheDocument();
  });

  // Free-text search now lives in the global header and reaches the page via
  // the `?q=` URL param (the header isn't mounted in this page-only test).
  it('filters by the ?q= search param', async () => {
    renderExplore('/?q=tide');
    expect(await screen.findByText('Test Tide Pools')).toBeInTheDocument();
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches the search', async () => {
    renderExplore('/?q=nothing-matches-this-zzz');
    expect(
      await screen.findByText('No activities match those filters.'),
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
