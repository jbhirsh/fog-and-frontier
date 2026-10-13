import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Activity } from '../data/types';
import type { MapBounds } from '../lib/mapBounds';
import { muirWoods } from '../test/fixtures';

// Fourteen activities heading north from San Jose, so the distance sort puts
// them in order: Spot 1 nearest, Spot 14 farthest.
const SPOTS: Activity[] = Array.from({ length: 14 }, (_, i) => ({
  ...muirWoods,
  id: `spot-${i + 1}`,
  name: `Spot ${i + 1}`,
  location: { city: 'Somewhere', coords: { lat: 37.4 + (i + 1) * 0.05, lng: -121.9 } },
}));

// The map as two buttons: a pin click on the farthest spot, and a pan that
// keeps every card.
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
    <div>
      <button onClick={() => onActivate?.(activities.find((a) => a.id === 'spot-14')!)}>
        pin spot-14
      </button>
      <button onClick={() => onBoundsChange?.({ north: 90, south: -90, east: 180, west: -180 })}>
        pan world
      </button>
    </div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

function stubViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: desktop,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CuratedAdventures />
    </MemoryRouter>,
    { activities: SPOTS },
  );
}

// jsdom has no scrollIntoView: record which cards it's called on, for the
// length of `run`.
async function recordScrolls(run: (scrolled: string[]) => Promise<void>) {
  const scrolled: string[] = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: Element) {
      scrolled.push(this.getAttribute('data-activity-id') ?? '');
    },
  });
  try {
    await run(scrolled);
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
}

const cardIds = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-activity-id]')].map((el) =>
    el.getAttribute('data-activity-id'),
  );

describe('Curated Adventures — a page of cards at a time (#102)', () => {
  beforeEach(() => stubViewport(true));
  afterEach(() => vi.unstubAllGlobals());

  it('shows six cards in Split, nearest first, with the rest behind Show more', async () => {
    const { container } = renderAt('/?view=split');
    expect(await screen.findByText('Spot 1')).toBeInTheDocument();
    expect(cardIds(container)).toEqual(SPOTS.slice(0, 6).map((a) => a.id));
    expect(screen.getByRole('button', { name: 'Show more (8 left)' })).toBeInTheDocument();
  });

  it('adds a page per Show more until every card is shown', async () => {
    const { container } = renderAt('/?view=split');
    await userEvent.click(await screen.findByRole('button', { name: 'Show more (8 left)' }));
    expect(cardIds(container)).toHaveLength(12);
    await userEvent.click(screen.getByRole('button', { name: 'Show more (2 left)' }));
    expect(cardIds(container)).toHaveLength(14);
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
  });

  it('starts List mode, with its wider grid, at twelve', async () => {
    const { container } = renderAt('/?view=list');
    await screen.findByText('Spot 1');
    expect(cardIds(container)).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Show more (2 left)' })).toBeInTheDocument();
  });

  it("fills List's larger page at once on a switch from Split", async () => {
    const { container } = renderAt('/?view=split');
    await screen.findByText('Spot 1');
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(cardIds(container)).toHaveLength(12);
  });

  it('starts the single-column List on a phone at six', async () => {
    stubViewport(false);
    const { container } = renderAt('/?view=list');
    await screen.findByText('Spot 1');
    expect(cardIds(container)).toHaveLength(6);
  });

  it('moves focus to the first card each Show more adds', async () => {
    renderAt('/?view=split');
    await userEvent.click(await screen.findByRole('button', { name: 'Show more (8 left)' }));
    expect(document.activeElement?.closest('[data-activity-id]')).toHaveAttribute(
      'data-activity-id',
      'spot-7',
    );
    // The last page removes the button; focus still lands on a new card.
    await userEvent.click(screen.getByRole('button', { name: 'Show more (2 left)' }));
    expect(document.activeElement?.closest('[data-activity-id]')).toHaveAttribute(
      'data-activity-id',
      'spot-13',
    );
  });

  it("renders down to a clicked pin's card and scrolls it into view", async () => {
    await recordScrolls(async (scrolled) => {
      const { container } = renderAt('/?view=split');
      await userEvent.click(await screen.findByRole('button', { name: 'pin spot-14' }));
      expect(cardIds(container)).toContain('spot-14');
      // Exactly once: a later page load doesn't scroll back to it.
      await userEvent.click(screen.getByRole('radio', { name: 'List' }));
      expect(scrolled).toEqual(['spot-14']);
    });
  });

  it('leaves the list alone for a pin clicked in desktop Map mode', async () => {
    await recordScrolls(async (scrolled) => {
      const { container } = renderAt('/?view=map');
      await userEvent.click(await screen.findByRole('button', { name: 'pin spot-14' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Split' }));
      expect(cardIds(container)).toHaveLength(6);
      await userEvent.click(screen.getByRole('button', { name: 'Show more (8 left)' }));
      expect(scrolled).toEqual([]);
    });
  });

  it('keeps its place when a map pan leaves the list unchanged', async () => {
    const { container } = renderAt('/?view=split');
    await userEvent.click(await screen.findByRole('button', { name: 'Show more (8 left)' }));
    expect(cardIds(container)).toHaveLength(12);
    await userEvent.click(screen.getByRole('button', { name: 'pan world' }));
    expect(cardIds(container)).toHaveLength(12);
  });
});
