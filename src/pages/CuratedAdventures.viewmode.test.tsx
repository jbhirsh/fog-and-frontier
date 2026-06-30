import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { muirWoods } from '../test/fixtures';

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
    { activities: [muirWoods] },
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the segmented control only on desktop; mobile gets a "Show map" button (#96)', () => {
    // Desktop (lg): the full List · Split · Map control.
    stubViewport(true);
    const { unmount } = renderAt('/');
    expect(
      screen.getByRole('radiogroup', { name: 'View mode' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show map' }),
    ).not.toBeInTheDocument();
    unmount();

    // Mobile: no segmented control — a floating "Show map" button instead.
    vi.unstubAllGlobals();
    renderAt('/');
    expect(
      screen.queryByRole('radiogroup', { name: 'View mode' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show map' }),
    ).toBeInTheDocument();
  });

  it('defaults to List on a mobile viewport (no matchMedia / not lg)', () => {
    renderAt('/');
    // List content is shown and no map is mounted by default on mobile.
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show map' }),
    ).toBeInTheDocument();
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

  it('mobile ?view=map: full map with the list riding in a draggable sheet (#96)', () => {
    renderAt('/?view=map');
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    // The list lives in a labelled sheet over the map, with a way back out.
    expect(
      screen.getByRole('region', { name: 'Activities in this area' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide map' }),
    ).toBeInTheDocument();
  });

  it('desktop ?view=map: full map, no mobile list sheet', () => {
    stubViewport(true);
    renderAt('/?view=map');
    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.queryByRole('region', { name: 'Activities in this area' }),
    ).not.toBeInTheDocument();
  });

  it('switches to Map mode when the "Show map" button is tapped (mobile)', async () => {
    renderAt('/');
    // Starts in List (mobile default) — hero visible, no map.
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show map' }));

    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
  });
});
