import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { MapBounds } from '../lib/mapBounds';
import { muirWoods } from '../test/fixtures';
import { PENDING_SUGGESTIONS } from '../lib/gqlDocs';

// Leaflet doesn't render in jsdom; a button stands in for panning the map to
// an empty patch, which narrows the list (the bounds filter, #95).
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({ onBoundsChange }: { onBoundsChange?: (b: MapBounds) => void }) => (
    <div data-testid="activity-map">
      <button
        type="button"
        onClick={() => onBoundsChange?.({ north: 1, south: 0, east: 1, west: 0 })}
      >
        pan empty
      </button>
    </div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

// The review queue's count in the toolbar (#259): owners see how many
// suggestions wait in every view, and it takes them to the queue, which
// only shows above the list.

const SIGNED_IN: AuthState = {
  isLoaded: true,
  email: 'friend@example.com',
  getToken: () => Promise.resolve(null),
};

type ForceOwner = { __TEST_FORCE_OWNER__?: boolean };

function suggestion(id: string, name: string) {
  return {
    __typename: 'ActivitySuggestion',
    id,
    suggestedBy: 'friend@example.com',
    suggestedAt: '2026-03-01T00:00:00.000Z',
    activity: {
      __typename: 'Activity',
      id,
      name,
      shortDescription: 'Bluffs',
      longDescription: null,
      category: 'scenic',
      location: { __typename: 'Location', city: 'San Francisco' },
      duration: 'Half Day',
      costTier: null,
      coverImage: '',
      allTrailsUrl: null,
      reservationUrl: null,
      menuUrl: null,
      notes: null,
    },
  };
}

let waiting = [suggestion('s1', 'Fort Funston')];
const pendingAnswer = vi.fn(() => ({ data: { pendingSuggestions: waiting } }));

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderAt(path: string) {
  return render(
    <AuthCtx.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[path]}>
        <CuratedAdventures />
        <Search />
      </MemoryRouter>
    </AuthCtx.Provider>,
    {
      activities: [muirWoods],
      mocks: [
        {
          request: { query: PENDING_SUGGESTIONS },
          result: pendingAnswer,
          maxUsageCount: Number.POSITIVE_INFINITY,
        },
      ],
    },
  );
}

function stubViewport(isLg: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: isLg,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

const review = (count: number, noun = 'suggestion') =>
  screen.findByRole('button', { name: `Review ${count} ${noun}` });
const bounded = () => screen.queryByRole('button', { name: /Clear bounds/ });
const queue = () => screen.queryByRole('region', { name: /Waiting for review/ });
const search = () => screen.getByTestId('search').textContent;

let scroll: ReturnType<typeof vi.fn>;
beforeEach(() => {
  waiting = [suggestion('s1', 'Fort Funston')];
  pendingAnswer.mockClear();
  // jsdom has no scrollIntoView.
  scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: scroll,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  delete (window as ForceOwner).__TEST_FORCE_OWNER__;
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
});

describe('Curated Adventures — the review count (#259)', () => {
  describe('for an owner', () => {
    beforeEach(() => {
      (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
    });

    it('counts what is waiting, and takes them to it in the list', async () => {
      renderAt('/');
      const button = await review(1);
      // A symbol and the count; the name and tooltip say what it counts.
      expect(button).toHaveTextContent(/^inbox1$/);
      expect(button).toHaveAttribute('title', 'Review suggestions');
      expect(scroll).not.toHaveBeenCalled();
      await userEvent.click(button);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(queue());
      expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveFocus();
    });

    it('counts more than one', async () => {
      waiting = [suggestion('s1', 'Fort Funston'), suggestion('s2', 'Lands End')];
      renderAt('/');
      expect(await review(2, 'suggestions')).toHaveTextContent(/^inbox2$/);
    });

    it('unfolds a queue that was folded away', async () => {
      renderAt('/');
      await userEvent.click(await screen.findByRole('button', { name: 'Waiting for review 1' }));
      expect(
        within(queue()!).queryByRole('heading', { name: 'Fort Funston' }),
      ).not.toBeInTheDocument();
      await userEvent.click(await review(1));
      expect(within(queue()!).getByRole('heading', { name: 'Fort Funston' })).toBeInTheDocument();
    });

    it('shows it on a desktop map, and goes to Split to show the queue', async () => {
      stubViewport(true);
      renderAt('/?view=map');
      const button = await review(1);
      expect(queue()).not.toBeInTheDocument();
      // The map's area filter stays: the map is still there in Split.
      await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
      await userEvent.click(button);
      expect(search()).toBe('?view=split');
      expect(queue()).toBeInTheDocument();
      expect(scroll.mock.contexts[0]).toBe(queue());
      expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveFocus();
      expect(bounded()).toBeInTheDocument();
    });

    it('shows it in the map sheet on a phone, and goes to the list to show the queue', async () => {
      stubViewport(false);
      renderAt('/?view=map');
      const sheet = screen.getByRole('region', { name: 'Activities on the map' });
      const button = await within(sheet).findByRole('button', { name: 'Review 1 suggestion' });
      // The list leaves the map behind, and with it the map's area filter,
      // as Hide map does.
      await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
      expect(bounded()).toBeInTheDocument();
      await userEvent.click(button);
      expect(search()).toBe('?view=list');
      expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();
      expect(bounded()).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveFocus();
    });

    it('stays in Split, where the queue already shows', async () => {
      stubViewport(true);
      renderAt('/?view=split');
      await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
      await userEvent.click(await review(1));
      expect(search()).toBe('?view=split');
      expect(bounded()).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveFocus();
    });

    it('scrolls there once, not again when the view comes back', async () => {
      stubViewport(true);
      renderAt('/?view=map');
      await userEvent.click(await review(1));
      expect(scroll).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole('radio', { name: /Map/ }));
      expect(queue()).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: /List/ }));
      expect(queue()).toBeInTheDocument();
      expect(scroll).toHaveBeenCalledTimes(1);
    });

    it('shows nothing when nothing is waiting', async () => {
      waiting = [];
      renderAt('/');
      await waitFor(() => expect(pendingAnswer).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
    });
  });

  it('shows no one else a count, or asks for one', async () => {
    stubViewport(true);
    renderAt('/?view=map');
    await screen.findByRole('button', { name: /Suggest activity/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
    expect(pendingAnswer).not.toHaveBeenCalled();
  });
});
