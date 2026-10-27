import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, useLocation } from 'react-router-dom';
import { render, screen, within } from '../test/render';
import { AuthCtx } from '../lib/authShim';
import { ActivityPermalinkRoutes } from '../components/ActivityPermalinkRoutes';
import type { Activity } from '../data/types';
import { dogFriendlyTidepools, muirWoods } from '../test/fixtures';
import { CuratedAdventures } from './CuratedAdventures';

// A park's hikes and stops (#269) sit under its card and open below its row.

const PARK: Activity = {
  ...muirWoods,
  id: 'test-park',
  name: 'Test Seashore',
  location: { city: 'Inverness, CA', coords: { lat: 38.04, lng: -122.8 } },
};
const LIGHTHOUSE: Activity = {
  ...muirWoods,
  id: 'test-lighthouse',
  name: 'Test Lighthouse',
  category: 'scenic',
  parentId: PARK.id,
  location: { city: 'Inverness, CA', coords: { lat: 37.9956, lng: -123.0224 } },
};
const CHIMNEY: Activity = {
  ...muirWoods,
  id: 'test-chimney',
  name: 'Test Chimney Rock',
  parentId: PARK.id,
  location: { city: 'Inverness, CA', coords: { lat: 37.9944, lng: -122.9662 } },
};

function Path() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderList(path = '/?view=list', email: string | null = null) {
  return render(
    <AuthCtx.Provider value={{ isLoaded: true, email, getToken: () => Promise.resolve(null) }}>
      <MemoryRouter initialEntries={[path]}>
        <ActivityPermalinkRoutes>
          <Route path="*" element={<CuratedAdventures />} />
        </ActivityPermalinkRoutes>
        <Path />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [PARK, LIGHTHOUSE, CHIMNEY, dogFriendlyTidepools] },
  );
}

// The cards at the top of the list: not the ones in a park's section.
const topLevel = () =>
  Array.from(document.querySelectorAll('[data-activity-id]'))
    .filter((el) => !el.closest('section[id^="park-"]'))
    .map((el) => el.getAttribute('data-activity-id'));

describe('a park’s hikes and stops in the list (#269)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds them under the park’s card, behind its bar', () => {
    renderList();
    expect(topLevel()).toEqual(expect.arrayContaining([PARK.id, dogFriendlyTidepools.id]));
    expect(topLevel()).toHaveLength(2);
    const bar = screen.getByRole('button', { name: '2 hikes & stops in Test Seashore' });
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Test Lighthouse')).not.toBeInTheDocument();
  });

  it('opens them as cards in a section of their own, and closes it again', async () => {
    renderList();
    const bar = screen.getByRole('button', { name: '2 hikes & stops in Test Seashore' });
    await userEvent.click(bar);
    expect(bar).toHaveAttribute('aria-expanded', 'true');
    const section = screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' });
    expect(bar).toHaveAttribute('aria-controls', section.id);
    expect(within(section).getByText('Test Lighthouse')).toBeInTheDocument();
    expect(within(section).getByText('Test Chimney Rock')).toBeInTheDocument();
    // List's wide grid: five across on a large screen.
    expect(section.querySelector('.grid')).toHaveClass('lg:grid-cols-5');

    await userEvent.click(
      within(section).getByRole('button', { name: "Close Test Seashore's hikes and stops" }),
    );
    expect(screen.queryByRole('region', { name: /Hikes & stops/ })).not.toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    // Focus goes back to the bar, rather than being lost with the button.
    expect(bar).toHaveFocus();

    // The bar toggles it too.
    await userEvent.click(bar);
    await userEvent.click(bar);
    expect(screen.queryByRole('region', { name: /Hikes & stops/ })).not.toBeInTheDocument();
  });

  it('opens a hike, or the park, from the section', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: '2 hikes & stops in Test Seashore' }));
    const section = screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' });
    await userEvent.click(within(section).getByRole('button', { name: /Test Lighthouse/ }));
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${LIGHTHOUSE.id}`);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
    );

    await userEvent.click(
      within(screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' })).getByRole(
        'button',
        { name: /View park/ },
      ),
    );
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${PARK.id}`);
  });

  it('steps through the list as shown, the open park’s own after it', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: '2 hikes & stops in Test Seashore' }));
    const order = Array.from(document.querySelectorAll('[data-activity-id]')).map((el) =>
      el.getAttribute('data-activity-id'),
    );
    expect(order).toHaveLength(4);
    const first = document.querySelector<HTMLElement>(`[data-activity-id="${order[0]}"]`)!;
    await userEvent.click(within(first).getAllByRole('button')[0]);
    const visited = [order[0]];
    for (let i = 1; i < order.length; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next adventure' }));
      visited.push(screen.getByTestId('path').textContent.replace('/activity/', ''));
    }
    expect(visited).toEqual(order);
  });

  it('steps on along the park’s row first, as a wide grid shows it', async () => {
    // Three columns: the park's row is the park and the two cards after it,
    // then its section.
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      return el instanceof HTMLElement && el.classList.contains('grid')
        ? { ...style, gridTemplateColumns: '1px 1px 1px' }
        : style;
    });
    const OTHER: Activity = { ...dogFriendlyTidepools, id: 'test-other', name: 'Test Other' };
    render(
      <MemoryRouter initialEntries={['/?view=list']}>
        <ActivityPermalinkRoutes>
          <Route path="*" element={<CuratedAdventures />} />
        </ActivityPermalinkRoutes>
        <Path />
      </MemoryRouter>,
      { activities: [PARK, LIGHTHOUSE, CHIMNEY, dogFriendlyTidepools, OTHER] },
    );
    await userEvent.click(screen.getByRole('button', { name: '2 hikes & stops in Test Seashore' }));
    const top = topLevel();
    expect(top).toHaveLength(3);
    const section = screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' });
    const held = Array.from(section.querySelectorAll('[data-activity-id]')).map((el) =>
      el.getAttribute('data-activity-id'),
    );
    expect(held).toHaveLength(2);
    const first = document.querySelector<HTMLElement>(`[data-activity-id="${top[0]}"]`)!;
    await userEvent.click(within(first).getAllByRole('button')[0]);
    const visited = [top[0]];
    for (let i = 1; i < 5; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next adventure' }));
      visited.push(screen.getByTestId('path').textContent.replace('/activity/', ''));
    }
    expect(visited).toEqual([...top, ...held]);
  });

  it('lists everything flat while selecting for a trip', async () => {
    renderList('/?view=list', 'editor@example.com');
    await userEvent.click(screen.getByRole('button', { name: /Select for trip/ }));
    expect(topLevel()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /hikes & stops in/ })).not.toBeInTheDocument();
  });

  it('shows a hike as a card of its own when a search leaves its park out', async () => {
    renderList('/?view=list&q=lighthouse');
    expect(await screen.findByText('Test Lighthouse')).toBeInTheDocument();
    expect(topLevel()).toEqual([LIGHTHOUSE.id]);
    expect(screen.queryByRole('button', { name: /hikes & stops/ })).not.toBeInTheDocument();
  });

  it('counts every place, nested or not', () => {
    renderList();
    expect(screen.getByText(/4 places · sorted/)).toBeInTheDocument();
    expect(screen.getByText(/4 places near/)).toBeInTheDocument();
  });
});

describe('a park’s hikes and stops on a phone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function asPhone() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767.98px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  it('stacks the park’s card, its count on the photo, with no bar under it', async () => {
    asPhone();
    renderList();
    const card = document.querySelector<HTMLElement>(`[data-activity-id="${PARK.id}"]`)!;
    const count = within(card).getByRole('button', { name: '2 hikes & stops in Test Seashore' });
    expect(count).toHaveTextContent(/2$/);
    expect(count).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('account_tree')).not.toBeInTheDocument();
    await userEvent.click(count);
    const section = screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' });
    expect(count).toHaveAttribute('aria-expanded', 'true');
    expect(count).toHaveAttribute('aria-controls', section.id);
    expect(within(section).getByText('Test Lighthouse')).toBeInTheDocument();
    // Closing the section gives focus back to the count it opened from.
    await userEvent.click(
      within(section).getByRole('button', { name: "Close Test Seashore's hikes and stops" }),
    );
    expect(screen.queryByRole('region', { name: /Hikes & stops/ })).not.toBeInTheDocument();
    expect(count).toHaveFocus();
  });
});
