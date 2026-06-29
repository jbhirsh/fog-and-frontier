import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
  seedActivities,
} from '../test/fixtures';
import type { MapBounds } from '../lib/mapBounds';

// Mock the map: instead of Leaflet, render two buttons that fire the
// `onBoundsChange` callback with a known viewport, so we can drive the bounds
// filter deterministically. The fixtures sit in California (lng ~ -122).
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({
    onBoundsChange,
  }: {
    onBoundsChange?: (b: MapBounds) => void;
  }) => (
    <div>
      <button
        data-testid="pan-world"
        onClick={() =>
          onBoundsChange?.({ north: 90, south: -90, east: 180, west: -180 })
        }
      >
        pan world
      </button>
      <button
        data-testid="pan-empty"
        onClick={() =>
          onBoundsChange?.({ north: 1, south: 0, east: 1, west: 0 })
        }
      >
        pan empty
      </button>
    </div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

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

function renderSplit() {
  return render(
    <MemoryRouter initialEntries={['/?view=split']}>
      <CuratedAdventures />
    </MemoryRouter>,
  );
}

describe('Curated Adventures — bounds filter (#95)', () => {
  beforeEach(() => {
    stubViewport(true); // desktop → Split, with the (mocked) map mounted
    seedActivities([muirWoods, completedHike, dogFriendlyTidepools]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows no bounds indicator until the map reports a viewport', () => {
    renderSplit();
    expect(screen.queryByText(/in this area/)).not.toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });

  it('keeps all cards for a world-spanning viewport and shows the indicator', async () => {
    renderSplit();
    await userEvent.click(screen.getByTestId('pan-world'));
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText(/in this area/)).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });

  it('narrows to the viewport (empty area → empty state) and Clear restores all', async () => {
    renderSplit();
    await userEvent.click(screen.getByTestId('pan-empty'));
    expect(
      screen.getByText('No activities in this area.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Clear bounds/ }));
    expect(screen.queryByText(/in this area/)).not.toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });
});
