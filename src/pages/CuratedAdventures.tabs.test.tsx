import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, type InitialEntry, type Location } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import type { MapBounds } from '../lib/mapBounds';
import { muirWoods } from '../test/fixtures';
import { PhoneTabBar } from '../components/PhoneTabBar';

// The phone's tab bar (#289) with the catalog: its Map and Places tabs in
// place of "Show map" and "Hide map", and its Add or Suggest tab opening the
// catalog's dialog.

vi.mock('../components/ActivityMap', () => ({
  ActivityMap: ({ onBoundsChange }: { onBoundsChange?: (b: MapBounds) => void }) => (
    <button
      type="button"
      onClick={() => onBoundsChange?.({ north: 1, south: 0, east: 1, west: 0 })}
    >
      pan empty
    </button>
  ),
}));

import { CuratedAdventures } from './CuratedAdventures';

type ForceOwner = { __TEST_FORCE_OWNER__?: boolean };

afterEach(() => {
  delete (window as ForceOwner).__TEST_FORCE_OWNER__;
});

function State() {
  const location: Location<unknown> = useLocation();
  return <output data-testid="state">{JSON.stringify(location.state)}</output>;
}

function renderAt(entry: InitialEntry, email: string | null = null) {
  const auth: AuthState = { isLoaded: true, email, name: null };
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <CuratedAdventures />
        <PhoneTabBar />
        <State />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods] },
  );
}

const ADD: InitialEntry = { pathname: '/', state: { add: true } };

function tabs() {
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('Curated Adventures — the phone’s tab bar (#289)', () => {
  it('leaves the map by Places, dropping its area filter', async () => {
    renderAt('/?view=map');
    await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
    expect(screen.getAllByText(/in this area/).length).toBeGreaterThan(0);
    await userEvent.click(tabs().getByRole('link', { name: 'Places' }));
    expect(screen.queryByRole('button', { name: 'pan empty' })).not.toBeInTheDocument();
    expect(screen.queryByText(/in this area/)).not.toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });

  it('opens the map at peek, however its sheet was left', async () => {
    renderAt('/');
    const grabber = (snap: string) =>
      screen.getByRole('button', { name: `Resize list, currently ${snap}` });
    await userEvent.click(tabs().getByRole('link', { name: 'Map' }));
    await userEvent.click(grabber('peek'));
    expect(grabber('half')).toBeInTheDocument();
    await userEvent.click(tabs().getByRole('link', { name: 'Places' }));
    await userEvent.click(tabs().getByRole('link', { name: 'Map' }));
    expect(grabber('peek')).toBeInTheDocument();
  });

  it("keeps the map's area when a tablet turns to landscape", async () => {
    // A viewport that crosses lg on cue, as turning an iPad does.
    let lg = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return lg;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    try {
      renderAt('/?view=map');
      await userEvent.click(screen.getByRole('button', { name: 'pan empty' }));
      expect(screen.getAllByText(/in this area/).length).toBeGreaterThan(0);
      // Landscape shows the map alone; back in portrait, its list is still
      // narrowed to the area.
      const turn = (to: boolean) => {
        lg = to;
        act(() => listeners.forEach((fn) => fn()));
      };
      turn(true);
      expect(screen.queryByRole('region', { name: 'Activities on the map' })).toBeNull();
      turn(false);
      expect(screen.getAllByText(/in this area/).length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('covers the tab bar with the selection bar while selecting', async () => {
    renderAt('/', 'member@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Select for trip' }));
    // Its Map tab would end the selection (the mobile map clears it), so the
    // bar sits over it, a layer up, as a phone's select mode does.
    const bar = screen.getByText('0 selected').closest('.fixed');
    expect(bar).toHaveClass('bottom-0', 'z-46');
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('z-45');
  });

  it('gives a phone no Show map, Hide map or Add of its own', () => {
    (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
    const { unmount } = renderAt('/', 'owner@example.com');
    expect(screen.getByRole('button', { name: 'Show map' })).toHaveClass(
      'hidden',
      'md:inline-flex',
    );
    // Room under the list for that button only where it shows.
    const list = screen.getByText('Test Muir Woods').closest('section');
    expect(list).toHaveClass('md:pb-24');
    expect(list).not.toHaveClass('pb-24');
    expect(screen.getByRole('button', { name: 'Add activity' })).toHaveClass(
      'hidden',
      'md:inline-flex',
    );
    unmount();
    renderAt('/?view=map');
    expect(screen.getByRole('button', { name: 'Hide map' })).toHaveClass(
      'hidden',
      'md:inline-flex',
    );
  });

  it('opens the add dialog for an owner from the Add tab, once', async () => {
    (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
    renderAt(ADD, 'owner@example.com');
    expect(await screen.findByRole('dialog', { name: 'Add activity' })).toBeInTheDocument();
    // The ask is dropped, so a reload or Back doesn't open it again.
    expect(screen.getByTestId('state')).toHaveTextContent('null');
  });

  it('opens the suggest dialog for anyone else signed in', async () => {
    renderAt(ADD, 'friend@example.com');
    expect(await screen.findByRole('dialog', { name: 'Suggest activity' })).toBeInTheDocument();
  });

  it('opens nothing for a signed-out visitor', () => {
    renderAt(ADD);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('{"add":true}');
  });

  it('opens it again from the tab after it was closed', async () => {
    renderAt('/', 'friend@example.com');
    await userEvent.click(tabs().getByRole('button', { name: /Suggest/ }));
    expect(await screen.findByRole('dialog', { name: 'Suggest activity' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(tabs().getByRole('button', { name: /Suggest/ }));
    expect(await screen.findByRole('dialog', { name: 'Suggest activity' })).toBeInTheDocument();
  });
});
