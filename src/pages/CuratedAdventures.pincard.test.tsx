import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { Activity } from '../data/types';
import { completedHike, muirWoods } from '../test/fixtures';

// A tapped pin on the mobile map shows its card (#291). The map is mocked:
// its buttons tap the first pin, or the map itself, and it says which pin
// it highlights.
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({
    activities,
    onActivate,
    onMapTap,
    highlightedId,
  }: {
    activities: Activity[];
    onActivate?: (a: Activity) => void;
    onMapTap?: () => void;
    highlightedId?: string | null;
  }) => (
    <div data-testid="activity-map" data-highlighted={highlightedId ?? ''}>
      {activities.map((a) => (
        <button key={a.id} type="button" onClick={() => onActivate?.(a)}>
          pin {a.name}
        </button>
      ))}
      <button type="button" onClick={() => onMapTap?.()}>
        tap map
      </button>
    </div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

function Path() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderMap(path = '/?view=map') {
  const auth: AuthState = { isLoaded: true, email: null, getToken: () => Promise.resolve(null) };
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <CuratedAdventures />
        <Path />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods, completedHike] },
  );
}

const card = () => screen.queryByRole('region', { name: 'Test Muir Woods' });
const sheet = () => screen.getByRole('region', { name: 'Activities on the map' });
const grabber = (snap: string) =>
  screen.getByRole('button', { name: `Resize list, currently ${snap}` });

describe('Curated Adventures — a tapped pin on the mobile map (#291)', () => {
  it('shows the pin’s card, highlights its pin, and opens nothing yet', async () => {
    renderMap();
    expect(card()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    expect(card()).toBeInTheDocument();
    expect(screen.getByTestId('activity-map')).toHaveAttribute('data-highlighted', 'test-muir');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('swaps in the next pin’s card, taking focus again', async () => {
    renderMap();
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Completed Hike' }));
    expect(card()).not.toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'Test Completed Hike' });
    expect(within(next).getByRole('heading', { name: 'Test Completed Hike' })).toHaveFocus();
    expect(screen.getByTestId('activity-map')).toHaveAttribute(
      'data-highlighted',
      'test-completed',
    );
  });

  it('drops the sheet to peek under the card', async () => {
    renderMap();
    await userEvent.click(grabber('peek'));
    expect(grabber('half')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    expect(grabber('peek')).toBeInTheDocument();
  });

  it('puts the card away on a tap on the map, or its ✕', async () => {
    renderMap();
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    await userEvent.click(screen.getByRole('button', { name: 'tap map' }));
    expect(card()).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-map')).toHaveAttribute('data-highlighted', '');
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    expect(card()).not.toBeInTheDocument();
  });

  it('opens the place’s detail from See details, putting the card away', async () => {
    // jsdom has no scrollIntoView; the detail scrolls its card into view.
    const scrolled = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrolled,
      configurable: true,
    });
    renderMap();
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    await userEvent.click(within(card()!).getByRole('button', { name: 'See details' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/activity/test-muir');
    expect(card()).not.toBeInTheDocument();
    // As tapping a pin did before, its card in the sheet comes into view.
    expect(scrolled).toHaveBeenCalled();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('puts the card away once a filter takes its pin off the map', async () => {
    renderMap();
    await userEvent.click(screen.getByRole('button', { name: 'pin Test Muir Woods' }));
    // Muir Woods isn't completed, so Completed only takes its pin off.
    await userEvent.click(screen.getByRole('switch', { name: 'Completed only' }));
    expect(card()).not.toBeInTheDocument();
  });

  it('makes the count at peek the way up to the whole list', async () => {
    renderMap();
    const count = screen.getByRole('button', { name: '2 places, see list' });
    // The count alone: the grab bar above it says the sheet slides up.
    expect(count).toHaveTextContent(/^2 places$/);
    await userEvent.click(count);
    expect(grabber('full')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see list/ })).not.toBeInTheDocument();
    // Above peek it's the count alone.
    expect(sheet()).toHaveTextContent('2 places');
  });

  it('puts a phone’s Filters in the sheet’s one header row', () => {
    renderMap();
    const header = screen.getByRole('button', { name: '2 places, see list' }).closest('.flex-wrap');
    expect(header).toContainElement(screen.getByRole('button', { name: /^Filters/ }));
  });
});
