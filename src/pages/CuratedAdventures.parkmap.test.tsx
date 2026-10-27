import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, useLocation } from 'react-router-dom';
import { render, screen, within } from '../test/render';
import { ActivityPermalinkRoutes } from '../components/ActivityPermalinkRoutes';
import type { Activity } from '../data/types';
import type { MapBounds } from '../lib/mapBounds';
import { muirWoods } from '../test/fixtures';

// The map, as pins to click: one button per activity it's given, and a way
// to pan it to just around the lighthouse.
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({
    activities,
    onActivate,
    onBoundsChange,
  }: {
    activities: Activity[];
    onActivate?: (a: Activity) => void;
    onBoundsChange?: (b: MapBounds) => void;
  }) => (
    <div data-testid="activity-map">
      {activities.map((a) => (
        <button key={a.id} type="button" onClick={() => onActivate?.(a)}>
          pin {a.name}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onBoundsChange?.({ north: 38.0, south: 37.99, east: -123.0, west: -123.1 })}
      >
        pan to the lighthouse
      </button>
    </div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

const PARK: Activity = { ...muirWoods, id: 'test-park', name: 'Test Seashore' };
const LIGHTHOUSE: Activity = {
  ...muirWoods,
  id: 'test-lighthouse',
  name: 'Test Lighthouse',
  parentId: PARK.id,
  location: { city: 'Inverness, CA', coords: { lat: 37.9956, lng: -123.0224 } },
};

function Path() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderSplit(path = '/?view=split') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityPermalinkRoutes>
        <Route path="*" element={<CuratedAdventures />} />
      </ActivityPermalinkRoutes>
      <Path />
    </MemoryRouter>,
    { activities: [PARK, LIGHTHOUSE] },
  );
}

describe('a park’s hikes and stops on the map (#269)', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plots the park, and its hikes only once it’s open', async () => {
    renderSplit();
    const map = screen.getByTestId('activity-map');
    expect(within(map).getByRole('button', { name: 'pin Test Seashore' })).toBeInTheDocument();
    expect(
      within(map).queryByRole('button', { name: 'pin Test Lighthouse' }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '1 hike or stop in Test Seashore' }));
    expect(within(map).getByRole('button', { name: 'pin Test Lighthouse' })).toBeInTheDocument();
  });

  it('opens a hike from its pin, its park’s section staying open to scroll to', async () => {
    renderSplit();
    await userEvent.click(screen.getByRole('button', { name: '1 hike or stop in Test Seashore' }));
    await userEvent.click(
      within(screen.getByTestId('activity-map')).getByRole('button', {
        name: 'pin Test Lighthouse',
      }),
    );
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${LIGHTHOUSE.id}`);
    const section = screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' });
    // Split's narrower grid: three across only on the widest screens.
    expect(section.querySelector('.grid')).toHaveClass('grid-cols-2', 'xl:grid-cols-3');
    expect(section.querySelector('.grid')).not.toHaveClass('lg:grid-cols-5');
    const lighthouse = document.querySelector(`[data-activity-id="${LIGHTHOUSE.id}"]`);
    expect(lighthouse).not.toBeNull();
    expect(scrollIntoView.mock.contexts).toContain(lighthouse);
  });

  it('keeps the park’s card while only its hikes are in view', async () => {
    renderSplit();
    await userEvent.click(screen.getByRole('button', { name: 'pan to the lighthouse' }));
    expect(screen.getByRole('button', { name: '1 hike or stop in Test Seashore' })).toBeVisible();
    expect(document.querySelector(`[data-activity-id="${PARK.id}"]`)).not.toBeNull();
  });

  it('narrows to the cards in view, a park staying for any of its own', async () => {
    // Out of the lighthouse's view: seven cards ahead of the park, and its
    // other hike.
    const before = Array.from({ length: 7 }, (_, i) => ({
      ...muirWoods,
      id: `test-a${i}`,
      name: `Test A${i}`,
    }));
    const FAR: Activity = { ...muirWoods, id: 'test-far', name: 'Test Far', parentId: PARK.id };
    render(
      <MemoryRouter initialEntries={['/?view=split']}>
        <ActivityPermalinkRoutes>
          <Route path="*" element={<CuratedAdventures />} />
        </ActivityPermalinkRoutes>
      </MemoryRouter>,
      { activities: [...before, PARK, LIGHTHOUSE, FAR] },
    );
    const cards = () =>
      Array.from(document.querySelectorAll('[data-activity-id]'))
        .filter((el) => !el.closest('section[id^="park-"]'))
        .map((el) => el.getAttribute('data-activity-id'));
    await userEvent.click(screen.getByRole('button', { name: 'pan to the lighthouse' }));
    expect(cards()).toEqual([PARK.id]);

    // Opened, then the view cleared: the park is eighth, past Split's first
    // six cards, so it closes rather than staying open out of sight.
    await userEvent.click(screen.getByRole('button', { name: '2 hikes & stops in Test Seashore' }));
    expect(
      within(screen.getByTestId('activity-map')).getByRole('button', { name: 'pin Test Far' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear bounds/ }));
    expect(cards()).toHaveLength(6);
    expect(screen.queryByRole('region', { name: /Hikes & stops/ })).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('activity-map')).queryByRole('button', { name: 'pin Test Far' }),
    ).not.toBeInTheDocument();
  });

  it('plots every pin in Map mode, which has no list to open a park from', () => {
    renderSplit('/?view=map');
    const map = screen.getByTestId('activity-map');
    expect(within(map).getByRole('button', { name: 'pin Test Lighthouse' })).toBeInTheDocument();
    expect(within(map).getByRole('button', { name: 'pin Test Seashore' })).toBeInTheDocument();
  });

  it('steps through every pin in Map mode, a hike’s too', async () => {
    renderSplit('/?view=map');
    await userEvent.click(
      within(screen.getByTestId('activity-map')).getByRole('button', {
        name: 'pin Test Lighthouse',
      }),
    );
    expect(screen.getByTestId('path')).toHaveTextContent(`/activity/${LIGHTHOUSE.id}`);
    // It's one of the two the map shows, which it steps between.
    expect(
      screen.getByRole('navigation', { name: /^Adventure \d of 2 in this list$/ }),
    ).toBeVisible();
  });

  it('keeps a park open when the page shrinks back (List to Split)', async () => {
    // Seven cards before the park: it's past Split's first page of six.
    const before = Array.from({ length: 7 }, (_, i) => ({
      ...muirWoods,
      id: `test-a${i}`,
      name: `Test A${i}`,
    }));
    render(
      <MemoryRouter initialEntries={['/?view=list']}>
        <ActivityPermalinkRoutes>
          <Route path="*" element={<CuratedAdventures />} />
        </ActivityPermalinkRoutes>
      </MemoryRouter>,
      { activities: [...before, { ...PARK, name: 'Test Z Seashore' }, LIGHTHOUSE] },
    );
    const bar = screen.getByRole('button', { name: '1 hike or stop in Test Z Seashore' });
    await userEvent.click(bar);
    await userEvent.click(screen.getByRole('radio', { name: 'Split' }));
    expect(
      screen.getByRole('region', { name: 'Hikes & stops in Test Z Seashore' }),
    ).toBeInTheDocument();
  });

  it('closes the park for good when the list goes away', async () => {
    renderSplit();
    await userEvent.click(screen.getByRole('button', { name: '1 hike or stop in Test Seashore' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Map' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Split' }));
    expect(screen.getByRole('button', { name: '1 hike or stop in Test Seashore' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(
      within(screen.getByTestId('activity-map')).queryByRole('button', {
        name: 'pin Test Lighthouse',
      }),
    ).not.toBeInTheDocument();
  });
});
