import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '../test/render';
import { ACTIVITIES_QUERY } from '../lib/gqlDocs';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, useLocation } from 'react-router-dom';
import { ActivityPermalinkRoutes } from '../components/ActivityPermalinkRoutes';
import type { CompletedSeed } from '../test/render';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="path">{pathname}</output>
      <output data-testid="search">{search}</output>
    </>
  );
}

function renderExplore(path = '/', completed: CompletedSeed[] = []) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityPermalinkRoutes>
        <Route path="*" element={<CuratedAdventures />} />
      </ActivityPermalinkRoutes>
      <LocationProbe />
    </MemoryRouter>,
    { activities: [muirWoods, completedHike, dogFriendlyTidepools], completed },
  );
}

const DONE = 'Only places we’ve done';

/** Opens the Filters sheet, for its choices. */
async function openFilters() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  return within(screen.getByRole('dialog', { name: 'Filters' }));
}

/** A segmented choice in the open Filters sheet, by its row and its words. */
function choice(row: string, name: string) {
  const sheet = within(screen.getByRole('dialog', { name: 'Filters' }));
  return within(sheet.getByRole('group', { name: row })).getByRole('button', { name });
}

describe('Curated Adventures page', () => {
  it('shows an error, not an empty catalog, when the catalog read fails', async () => {
    render(
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>,
      { activitiesError: true },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load activities");
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
    expect(await screen.findByText('No activities match those filters.')).toBeInTheDocument();
  });

  it('filters by duration', async () => {
    renderExplore();
    await openFilters();
    await userEvent.click(choice('How long', 'Half day'));
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
  });

  it('filters by max distance', async () => {
    renderExplore();
    await openFilters();
    await userEvent.click(choice('How far', '25 mi'));
    // From San Jose, all fixtures are >25 miles away.
    expect(screen.getByText('No activities match those filters.')).toBeInTheDocument();
  });

  it('picks how much, up to a tier (#85)', async () => {
    render(
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>,
      {
        activities: [
          { ...muirWoods, costTier: 'free' },
          { ...completedHike, costTier: '$$' },
          dogFriendlyTidepools,
        ],
      },
    );
    await openFilters();
    await userEvent.click(choice('How much', 'Free'));
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
    // Up to $$: the free one too, and never one whose cost isn't known.
    await userEvent.click(choice('How much', '$$'));
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
    expect(screen.queryByText('Test Tide Pools')).not.toBeInTheDocument();
  });

  it('keeps How much in the sheet while a cost is picked, after the last priced activity changes (#85)', async () => {
    const { cache } = render(
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>,
      // The mount's background fetch is held, or it could land after the
      // edit below and put the cost back.
      {
        activities: [{ ...muirWoods, costTier: 'free' }, completedHike],
        activitiesDelay: Infinity,
      },
    );
    await openFilters();
    await userEvent.click(choice('How much', 'Free'));
    // The only priced activity loses its cost.
    act(() => {
      const data = cache.readQuery({ query: ACTIVITIES_QUERY })!;
      cache.writeQuery({
        query: ACTIVITIES_QUERY,
        data: { activities: data.activities.map((a) => ({ ...a, costTier: null })) },
      });
    });
    await waitFor(() => expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument());
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }));
    expect(choice('How much', 'Free')).toHaveAttribute('aria-pressed', 'true');
    // Any brings the catalog back, and How much goes with it.
    await userEvent.click(choice('How much', 'Any'));
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(sheet.queryByRole('group', { name: 'How much' })).not.toBeInTheDocument();
  });

  it('offers no cost until some cost is known (#85)', async () => {
    renderExplore();
    const sheet = await openFilters();
    expect(sheet.queryByRole('group', { name: 'How much' })).not.toBeInTheDocument();
  });

  it('toggles dog-friendly filter', async () => {
    renderExplore();
    const sheet = await openFilters();
    const toggle = sheet.getByRole('switch', { name: 'Dogs welcome' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
    expect(screen.getByText('Test Tide Pools')).toBeInTheDocument();
  });

  // Cards open their permalink (#86) over the catalog, which keeps its
  // filters underneath; closing goes back to it.
  it('opens a card at its permalink and closes back to the filtered catalog', async () => {
    renderExplore('/?q=muir');
    await userEvent.click(screen.getByRole('button', { name: /Test Muir Woods/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${muirWoods.id}`);
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
    expect(screen.getByTestId('search')).toHaveTextContent('?q=muir');
    expect(screen.queryByText('Test Tide Pools')).not.toBeInTheDocument();
  });

  // Prev/next (#64) steps through the list as shown: its filters and order.
  it('opens a card with the list as shown, to step through', async () => {
    renderExplore('/');
    const order = Array.from(document.querySelectorAll('[data-activity-id]'), (el) =>
      el.getAttribute('data-activity-id'),
    );
    expect(order).toHaveLength(3);
    const second = [muirWoods, completedHike, dogFriendlyTidepools].find((a) => a.id === order[1])!;
    await userEvent.click(screen.getByRole('button', { name: new RegExp(second.name) }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 of 3')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next adventure' }));
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${order[2]}`);
  });

  it('has nothing to step through when the filters leave one card', async () => {
    renderExplore('/?q=muir');
    await userEvent.click(screen.getByRole('button', { name: /Test Muir Woods/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Next adventure' })).toBeNull();
  });

  describe('Completed only (#5)', () => {
    it('is off by default and shows every activity', async () => {
      renderExplore();
      const sheet = await openFilters();
      expect(sheet.getByRole('switch', { name: DONE })).not.toBeChecked();
      expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    });

    it('filters to completed activities from ?completed=1', async () => {
      renderExplore('/?completed=1');
      expect(await screen.findByText(/^1 place · sorted/)).toBeInTheDocument();
      const sheet = await openFilters();
      expect(sheet.getByRole('switch', { name: DONE })).toBeChecked();
      expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
      expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
      expect(screen.queryByText('Test Tide Pools')).not.toBeInTheDocument();
    });

    it('toggles the filter and syncs ?completed=1 to the URL', async () => {
      renderExplore('/?q=test');
      const sheet = await openFilters();
      await userEvent.click(sheet.getByRole('switch', { name: DONE }));
      const toggle = sheet.getByRole('switch', { name: DONE });
      expect(toggle).toBeChecked();
      expect(screen.getByTestId('search')).toHaveTextContent('?q=test&completed=1');
      expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
      expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();

      await userEvent.click(toggle);
      expect(sheet.getByRole('switch', { name: DONE })).not.toBeChecked();
      expect(screen.getByTestId('search')).toHaveTextContent(/^\?q=test$/);
      expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    });

    it('uses the completion overrides, not just the baseline flag', async () => {
      renderExplore('/?completed=1', [
        { id: muirWoods.id, completed: true },
        { id: completedHike.id, completed: false },
      ]);
      expect(await screen.findByText('Test Muir Woods')).toBeInTheDocument();
      expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
    });
  });
});
