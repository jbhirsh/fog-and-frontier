import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { MapBounds } from '../lib/mapBounds';
import { muirWoods } from '../test/fixtures';

// Mock the map so these layout-shell tests never touch Leaflet (which doesn't
// render in jsdom). We only care that the page mounts the map in the right
// modes, not what the map draws; the button reports a viewport with no
// activities in it, to drive the bounds filter.
vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({
    activities,
    fullBleed,
    onBoundsChange,
  }: {
    activities: { id: string }[];
    fullBleed?: boolean;
    onBoundsChange?: (b: MapBounds) => void;
  }) => (
    <div data-testid="activity-map" data-fullbleed={String(!!fullBleed)}>
      map:{activities.length}
      <button
        type="button"
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

function renderAt(
  path: string,
  opts: { activitiesError?: boolean; email?: string } = {},
) {
  const auth: AuthState = {
    isLoaded: true,
    email: opts.email ?? null,
    getToken: () => Promise.resolve(null),
  };
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <CuratedAdventures />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods], activitiesError: opts.activitiesError },
  );
}

const sheet = () =>
  screen.getByRole('region', { name: 'Activities on the map' });
const showMap = () => screen.getByRole('button', { name: 'Show map' });
const grabber = (snap: string) =>
  screen.getByRole('button', { name: `Resize list, currently ${snap}` });

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
    stubViewport(true);
    const { unmount } = renderAt('/');
    expect(
      screen.getByRole('radiogroup', { name: 'View mode' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show map' }),
    ).not.toBeInTheDocument();
    unmount();

    vi.unstubAllGlobals();
    renderAt('/');
    expect(
      screen.queryByRole('radiogroup', { name: 'View mode' }),
    ).not.toBeInTheDocument();
    expect(showMap()).toBeInTheDocument();
  });

  it('defaults to List on a mobile viewport (no matchMedia / not lg)', () => {
    renderAt('/');
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();
  });

  it('falls back to List for ?view=split on a mobile viewport', () => {
    renderAt('/?view=split');
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();
    expect(showMap()).toBeInTheDocument();
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

  it('desktop ?view=map: the framed full map with the toolbar, no sheet', () => {
    stubViewport(true);
    renderAt('/?view=map');
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-map')).toHaveAttribute(
      'data-fullbleed',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.queryByRole('region', { name: 'Activities on the map' }),
    ).not.toBeInTheDocument();
  });

  it('mobile ?view=map: a full-bleed map with the list in a sheet at peek (#96)', () => {
    renderAt('/?view=map');
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-map')).toHaveAttribute(
      'data-fullbleed',
      'true',
    );
    // The list rides in the sheet, with the count and a way back out.
    expect(within(sheet()).getByText('Test Muir Woods')).toBeInTheDocument();
    expect(sheet()).toHaveTextContent('1 place');
    expect(sheet()).not.toHaveTextContent('1 places');
    expect(
      within(sheet()).getByRole('button', { name: 'Hide map' }),
    ).toBeInTheDocument();
    expect(grabber('peek')).toBeInTheDocument();
    // The toolbar isn't shown, but its filter chips ride in the sheet so
    // active filters stay visible and changeable; no floating button.
    expect(
      within(sheet()).getByRole('switch', { name: 'Dog friendly' }),
    ).toBeInTheDocument();
    expect(
      within(sheet()).getByRole('switch', { name: 'Completed only' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('radiogroup', { name: 'View mode' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show map' }),
    ).not.toBeInTheDocument();
  });

  it('filters the mobile map from the chips in its sheet', async () => {
    renderAt('/?view=map');
    expect(screen.getByTestId('activity-map')).toHaveTextContent('map:1');
    await userEvent.click(
      within(sheet()).getByRole('switch', { name: 'Completed only' }),
    );
    // The fixture isn't completed, so the filter empties the map.
    expect(screen.getByTestId('activity-map')).toHaveTextContent('map:0');
  });

  it('opens the mobile map from the "Show map" button', async () => {
    renderAt('/');
    await userEvent.click(showMap());

    expect(screen.getByTestId('activity-map')).toBeInTheDocument();
    expect(sheet()).toBeInTheDocument();
    expect(screen.queryByText('Curated Adventures')).not.toBeInTheDocument();
  });

  it('summarises the bounds filter in the sheet header, with a way to clear it', async () => {
    renderAt('/?view=map');
    await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
    expect(sheet()).toHaveTextContent('Showing 0 in this area');
    expect(
      within(sheet()).getByText('No activities in this area.'),
    ).toBeInTheDocument();

    await userEvent.click(
      within(sheet()).getByRole('button', { name: 'Clear bounds' }),
    );
    expect(sheet()).not.toHaveTextContent('in this area');
    expect(sheet()).toHaveTextContent('1 place');
    expect(within(sheet()).getByText('Test Muir Woods')).toBeInTheDocument();
  });

  it('"Hide map" returns to the full list with the bounds filter dropped', async () => {
    renderAt('/?view=map');
    await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide map' }));

    expect(screen.queryByTestId('activity-map')).not.toBeInTheDocument();
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.queryByText(/in this area/)).not.toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(showMap()).toBeInTheDocument();
  });

  it('reopens the map with the sheet collapsed to peek', async () => {
    renderAt('/');
    await userEvent.click(showMap());
    await userEvent.click(grabber('peek'));
    expect(grabber('half')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide map' }));
    await userEvent.click(showMap());
    expect(grabber('peek')).toBeInTheDocument();
  });

  it('shows a failed catalog read in the mobile sheet', async () => {
    renderAt('/?view=map', { activitiesError: true });
    expect(await within(sheet()).findByRole('alert')).toBeInTheDocument();
  });

  it('ends a selection when the window narrows into the mobile map', async () => {
    // A controllable viewport: start at lg, then narrow below it.
    let isLg = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          get matches() {
            return isLg;
          },
          media: query,
          addEventListener: (_: string, fn: () => void) => listeners.add(fn),
          removeEventListener: (_: string, fn: () => void) =>
            listeners.delete(fn),
        }) as unknown as MediaQueryList,
    );
    renderAt('/?view=map', { email: 'editor@example.com' });
    await userEvent.click(
      screen.getByRole('button', { name: /Select for trip/ }),
    );
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();

    isLg = false;
    act(() => listeners.forEach((fn) => fn()));
    expect(sheet()).toBeInTheDocument();
    // The selection bar would sit under the sheet; selection ends instead.
    expect(screen.queryByText(/0 selected/)).not.toBeInTheDocument();
  });

  it('hides the "Show map" button while selecting for a trip', async () => {
    renderAt('/', { email: 'editor@example.com' });
    expect(showMap()).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Select for trip/ }),
    );
    expect(
      screen.queryByRole('button', { name: 'Show map' }),
    ).not.toBeInTheDocument();
  });
});
