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
    const durationSelect = screen.getByDisplayValue('Any duration');
    await userEvent.selectOptions(durationSelect, 'Half day');
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
  });

  it('filters by max distance', async () => {
    renderExplore();
    const distanceSelect = screen.getByDisplayValue('Any distance');
    await userEvent.selectOptions(distanceSelect, '25');
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
    const cost = screen.getByRole('combobox', { name: 'Cost' });
    expect(cost).toHaveValue('Any');
    // Its icon is pulled out by its glyph's empty side, like the others'.
    expect(
      cost.closest('label')?.querySelector<HTMLElement>('.material-symbols-outlined')?.style
        .marginLeft,
    ).toBe('-0.042em');
    await userEvent.selectOptions(cost, 'Free');
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
    // Up to $$: the free one too, and never one whose cost isn't known.
    await userEvent.selectOptions(cost, 'Up to $$');
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
    expect(screen.queryByText('Test Tide Pools')).not.toBeInTheDocument();
  });

  it('keeps the cost picker on screen while a cost is picked, after the last priced activity changes (#85)', async () => {
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cost' }), 'Free');
    // The only priced activity loses its cost.
    act(() => {
      const data = cache.readQuery({ query: ACTIVITIES_QUERY })!;
      cache.writeQuery({
        query: ACTIVITIES_QUERY,
        data: { activities: data.activities.map((a) => ({ ...a, costTier: null })) },
      });
    });
    await waitFor(() => expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument());
    const cost = screen.getByRole('combobox', { name: 'Cost' });
    expect(cost).toHaveValue('free');
    // Any cost brings the catalog back, and the picker goes with it.
    await userEvent.selectOptions(cost, 'Any cost');
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Cost' })).not.toBeInTheDocument();
  });

  it('offers no cost picker until some cost is known (#85)', () => {
    renderExplore();
    expect(screen.queryByRole('combobox', { name: 'Cost' })).not.toBeInTheDocument();
  });

  it("shows each filter pill's choice as its label, and names each select", async () => {
    renderExplore();
    // The pill's label is the visible text; the select under it is invisible.
    const pillText = (name: string) =>
      screen
        .getByRole('combobox', { name })
        .closest('label')
        ?.querySelector('span[aria-hidden="true"].whitespace-nowrap')?.textContent;
    expect(pillText('Distance')).toBe('Any distance');
    expect(pillText('Duration')).toBe('Any duration');
    expect(pillText('Category')).toBe('Any category');
    expect(pillText('Park type')).toBe('Any park type');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distance' }), '25');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Duration' }), 'half');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'hiking');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Park type' }), 'state');
    expect(pillText('Distance')).toMatch(/^Within 25 mi of \S/);
    expect(pillText('Duration')).toBe('Half day');
    expect(pillText('Category')).toBe('Hiking');
    expect(pillText('Park type')).toBe('State park');
  });

  it('spells out the category options rather than leaving them to CSS', () => {
    renderExplore();
    const options = within(screen.getByRole('combobox', { name: 'Category' })).getAllByRole(
      'option',
    );
    expect(options.map((o) => o.textContent)).toEqual([
      'Any category',
      'Hiking',
      'Cycling',
      'Water',
      'Food',
      'Culture',
      'Scenic',
      'Climbing',
      'Camping',
      'Other',
    ]);
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

  // Cards open their permalink (#86) over the catalog, which keeps its
  // filters underneath; closing goes back to it.
  it('opens a card at its permalink and closes back to the filtered catalog', async () => {
    renderExplore('/?q=muir');
    await userEvent.click(screen.getByRole('button', { name: /Test Muir Woods/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${muirWoods.id}`);
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
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
    it('is off by default and shows every activity', () => {
      renderExplore();
      expect(screen.getByRole('switch', { name: 'Completed only' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    });

    it('filters to completed activities from ?completed=1', async () => {
      renderExplore('/?completed=1');
      expect(screen.getByRole('switch', { name: 'Completed only' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
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
      expect(screen.getByTestId('search')).toHaveTextContent('?q=test&completed=1');
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
      expect(screen.queryByText('Test Completed Hike')).not.toBeInTheDocument();
    });
  });
});
