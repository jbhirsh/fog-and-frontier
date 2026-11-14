import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../test/render';
import { MemoryRouter } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { Activity } from '../data/types';
import { completedHike, muirWoods } from '../test/fixtures';
import { stubMatchMedia } from '../test/matchMedia';
import { RouteStateProbe } from '../test/RouteStateProbe';

// The map and the list point at each other (#94): a hovered pin lights its
// card, a hovered card its pin, and a pin's popup opens the place. The map is
// mocked: it says what it highlights and keeps in view, and its buttons stand
// for the pointer on the first pin.
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({
    activities,
    fullBleed,
    onSelect,
    onActivate,
    onPinHoverChange,
    highlightedId,
    keepInViewId,
  }: {
    activities: Activity[];
    fullBleed?: boolean;
    onSelect: (a: Activity) => void;
    onActivate?: (a: Activity) => void;
    onPinHoverChange?: (a: Activity | null) => void;
    highlightedId?: string | null;
    keepInViewId?: string | null;
  }) => (
    <div
      data-testid={fullBleed ? 'mobile-map' : 'map'}
      data-highlighted={highlightedId ?? ''}
      data-keep={keepInViewId ?? 'none'}
    >
      <button type="button" onClick={() => onSelect(activities[0])}>
        open first pin
      </button>
      <button type="button" onClick={() => onActivate?.(activities[0])}>
        tap first pin
      </button>
      <button type="button" onClick={() => onPinHoverChange?.(activities[0])}>
        hover first pin
      </button>
      <button type="button" onClick={() => onPinHoverChange?.(null)}>
        leave pin
      </button>
    </div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SIGNED_OUT: AuthState = { isLoaded: true, email: null, name: null };

// Muir Woods is nearer the default origin, so it is the first pin.
function renderAt(path: string, desktop: boolean) {
  // Every width query matches on a desktop and none on a phone.
  stubMatchMedia(() => desktop);
  return render(
    <AuthCtx.Provider value={SIGNED_OUT}>
      <MemoryRouter initialEntries={[path]}>
        <CuratedAdventures />
        <RouteStateProbe />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods, completedHike] },
  );
}

function firstPinId() {
  return screen.getByTestId(/map$/).dataset.highlighted;
}

// Whether a card's photo carries the highlight its pin's hover gives it.
function isLit(container: HTMLElement, id: string) {
  const card = container.querySelector(`[data-activity-id="${id}"]`);
  if (!card) throw new Error(`no card ${id}`);
  return card.querySelector('.outline-2') !== null;
}

function hoverAndLeave(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', { name: 'hover first pin' }));
  const lit = [muirWoods.id, completedHike.id].filter((id) => isLit(container, id));
  fireEvent.click(screen.getByRole('button', { name: 'leave pin' }));
  const after = [muirWoods.id, completedHike.id].filter((id) => isLit(container, id));
  return { lit, after };
}

describe('Curated Adventures — the map and the list (#94)', () => {
  it('lights a hovered pin’s card in Split, and a hovered card’s pin', () => {
    const { container } = renderAt('/?view=split', true);
    expect(firstPinId()).toBe('');
    expect(hoverAndLeave(container)).toEqual({ lit: [muirWoods.id], after: [] });

    const card = container.querySelector(`[data-activity-id="${completedHike.id}"]`)!;
    fireEvent.mouseEnter(card);
    expect(screen.getByTestId('map')).toHaveAttribute('data-highlighted', completedHike.id);
    fireEvent.mouseLeave(card);
    expect(screen.getByTestId('map')).toHaveAttribute('data-highlighted', '');
  });

  it('lights a hovered pin’s card in the mobile map’s sheet', () => {
    const { container } = renderAt('/?view=map', false);
    expect(hoverAndLeave(container)).toEqual({ lit: [muirWoods.id], after: [] });
  });

  it('keeps a tapped pin in view while its card shows', () => {
    renderAt('/?view=map', false);
    expect(screen.getByTestId('mobile-map')).toHaveAttribute('data-keep', 'none');
    fireEvent.click(screen.getByRole('button', { name: 'tap first pin' }));
    expect(screen.getByTestId('mobile-map')).toHaveAttribute('data-keep', muirWoods.id);
  });

  it.each([
    ['Split', '/?view=split', true],
    ['Map', '/?view=map', true],
    ['the mobile map', '/?view=map', false],
  ])('opens a pin’s place from %s', (_label, path, desktop) => {
    renderAt(path, desktop);
    fireEvent.click(screen.getByRole('button', { name: 'open first pin' }));
    expect(screen.getByTestId('route-state')).toHaveTextContent(`/activity/${muirWoods.id}`);
  });

  describe('scrolls a tapped pin’s card into view, whatever its id', () => {
    const QUOTED: Activity = { ...muirWoods, id: 'test"muir' };

    // jsdom has no scrollIntoView: record the cards it's called on.
    function stubScroll() {
      const scrolled = vi.fn<(this: Element, options?: ScrollIntoViewOptions) => void>();
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: scrolled,
        configurable: true,
      });
      return scrolled;
    }

    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('escaping it where the browser can', () => {
      vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/["\\]/g, '\\$&') });
      const scrolled = stubScroll();
      stubMatchMedia(() => true);
      render(
        <AuthCtx.Provider value={SIGNED_OUT}>
          <MemoryRouter initialEntries={['/?view=split']}>
            <CuratedAdventures />
          </MemoryRouter>
        </AuthCtx.Provider>,
        { activities: [QUOTED] },
      );
      fireEvent.click(screen.getByRole('button', { name: 'tap first pin' }));
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toHaveAttribute('data-activity-id', QUOTED.id);
      expect(scrolled.mock.calls[0]).toEqual([{ block: 'nearest', behavior: 'smooth' }]);
    });

    it('as it is where the browser has no CSS.escape', () => {
      vi.stubGlobal('CSS', undefined);
      const scrolled = stubScroll();
      renderAt('/?view=split', true);
      fireEvent.click(screen.getByRole('button', { name: 'tap first pin' }));
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toHaveAttribute('data-activity-id', muirWoods.id);
    });
  });
});
