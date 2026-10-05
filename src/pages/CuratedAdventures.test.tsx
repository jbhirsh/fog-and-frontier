import { describe, expect, it } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CompletedSeed } from '../test/render';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
} from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

function renderExplore(path = '/', completed: CompletedSeed[] = []) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CuratedAdventures />
      <LocationProbe />
    </MemoryRouter>,
    { activities: [muirWoods, completedHike, dogFriendlyTidepools], completed },
  );
}

describe('Curated Adventures page', () => {

  it('shows an error, not an empty catalog, when the catalog read fails', async () => {
    render(
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>,
      { activitiesError: true },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load activities",
    );
  });

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
    const toggle = screen.getByRole('switch', { name: 'Dog friendly' });
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

  describe('Completed only (#5)', () => {
    it('is off by default and shows every activity', () => {
      renderExplore();
      expect(
        screen.getByRole('switch', { name: 'Completed only' }),
      ).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    });

    it('filters to completed activities from ?completed=1', async () => {
      renderExplore('/?completed=1');
      expect(
        screen.getByRole('switch', { name: 'Completed only' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(await screen.findByText(/^1 place · sorted/)).toBeInTheDocument();
      expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
      expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
      expect(screen.queryByText('Test Tide Pools')).not.toBeInTheDocument();
    });

    it('toggles the filter and syncs ?completed=1 to the URL', async () => {
      renderExplore('/?q=test');
      const toggle = screen.getByRole('switch', { name: 'Completed only' });
      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('search')).toHaveTextContent(
        '?q=test&completed=1',
      );
      expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
      expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();

      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByTestId('search')).toHaveTextContent(/^\?q=test$/);
      expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    });

    it('uses the completion overrides, not just the baseline flag', async () => {
      renderExplore('/?completed=1', [
        { id: muirWoods.id, completed: true },
        { id: completedHike.id, completed: false },
      ]);
      expect(await screen.findByText('Test Muir Woods')).toBeInTheDocument();
      expect(
        screen.queryByText('Test Completed Hike'),
      ).not.toBeInTheDocument();
    });
  });
});
