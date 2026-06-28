import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { muirWoods, seedActivities } from '../test/fixtures';

// Mock the map so these layout-shell tests never touch Leaflet (which doesn't
// render in jsdom). We only care that the page mounts the map in the right
// modes, not what the map draws.
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({ activities }: { activities: { id: string }[] }) => (
    <div data-testid="activity-map">map:{activities.length}</div>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CuratedAdventures />
    </MemoryRouter>,
  );
}

// jsdom has no `matchMedia`; stub it so `useMediaQuery('(min-width:1024px)')`
// can report either a desktop (lg) or mobile viewport per test.
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

describe('Curated Adventures — view modes (#93)', () => {
  beforeEach(() => {
    seedActivities([muirWoods]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the view-mode segmented control', () => {
    renderAt('/');
    expect(
      screen.getByRole('radiogroup', { name: 'View mode' }),
    ).toBeInTheDocument();
  });

  it('defaults to List on a mobile viewport (no matchMedia / not lg)', () => {
    renderAt('/');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();
  });

  it('defaults to Split (with a map) on a desktop viewport', () => {
    stubViewport(true);
    renderAt('/');
    expect(screen.getByRole('radio', { name: 'Split' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    // List still renders beside the map.
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });

  it('honours an explicit ?view=map: hides the hero and shows the full map', () => {
    renderAt('/?view=map');
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('switches to Map mode when the Map segment is clicked', async () => {
    renderAt('/');
    // Starts in List (mobile default) — hero visible, no map.
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Map' }));

    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
  });
});
