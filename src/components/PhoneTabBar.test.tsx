import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom';
import { PhoneTabBar } from './PhoneTabBar';

const owner = vi.hoisted(() => ({ isOwner: false, email: null as string | null }));
vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({ isOwner: owner.isOwner, isLoaded: true, email: owner.email }),
}));

function Where() {
  const location: Location<unknown> = useLocation();
  return (
    <output data-testid="where">
      {location.pathname}
      {location.search}|{JSON.stringify(location.state)}
    </output>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PhoneTabBar />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function tabs() {
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('PhoneTabBar (#289)', () => {
  beforeEach(() => {
    owner.isOwner = false;
    owner.email = null;
  });

  it('is a phone’s main navigation, gone from md up', () => {
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('md:hidden', 'fixed');
  });

  it('keeps its tabs equal while the icon font loads', () => {
    renderAt('/');
    // Before the font, each icon is its name in plain text, wide enough to
    // push the last tab off the screen were it free to grow.
    const places = screen.getByRole('link', { name: /Places/ });
    expect(places).toHaveClass('flex-1', 'min-w-0');
    expect(places.querySelector('.material-symbols-outlined')).toHaveClass(
      'size-6',
      'overflow-hidden',
    );
  });

  it('marks the tab of the page it’s on', () => {
    const { unmount } = renderAt('/');
    expect(tabs().getByRole('link', { name: 'Places' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'Map' })).not.toHaveAttribute('aria-current');
    unmount();
    renderAt('/trips/abc');
    expect(tabs().getByRole('link', { name: 'Trips' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'Places' })).not.toHaveAttribute('aria-current');
  });

  it('marks Map on the map, and keeps the catalog’s search and filters both ways', () => {
    renderAt('/?q=redwood&completed=1&view=map');
    expect(tabs().getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/?q=redwood&completed=1&view=map',
    );
    expect(tabs().getByRole('link', { name: 'Places' })).toHaveAttribute(
      'href',
      '/?q=redwood&completed=1',
    );
  });

  it('drops another page’s params on the way to the catalog', () => {
    renderAt('/share?url=https://instagram.com/p/x');
    expect(tabs().getByRole('link', { name: 'Places' })).toHaveAttribute('href', '/');
    expect(tabs().getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/?view=map');
  });

  it('offers a signed-out visitor no Add, Suggest or Explore', () => {
    renderAt('/');
    expect(tabs().queryByRole('button')).not.toBeInTheDocument();
    expect(tabs().queryByRole('link', { name: 'Explore' })).not.toBeInTheDocument();
    expect(
      tabs()
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['format_list_bulletedPlaces', 'mapMap', 'luggageTrips']);
  });

  it('offers a signed-in non-owner Suggest, and an owner Add and Explore', () => {
    owner.email = 'tarun@example.com';
    const { unmount } = renderAt('/');
    expect(tabs().getByRole('button', { name: /Suggest/ })).toBeInTheDocument();
    expect(tabs().queryByRole('link', { name: 'Explore' })).not.toBeInTheDocument();
    unmount();
    owner.isOwner = true;
    renderAt('/explore');
    expect(tabs().getByRole('button', { name: /Add/ })).toBeInTheDocument();
    expect(tabs().getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers an owner Add before their email is known', () => {
    owner.isOwner = true;
    renderAt('/');
    expect(tabs().getByRole('button', { name: /Add/ })).toBeInTheDocument();
  });

  it('asks the catalog to open its dialog, keeping its search', async () => {
    owner.email = 'tarun@example.com';
    renderAt('/?q=redwood&view=map');
    await userEvent.click(tabs().getByRole('button', { name: /Suggest/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/?q=redwood|{"add":true}');
  });

  it('goes to the catalog for it from another page', async () => {
    owner.isOwner = true;
    renderAt('/trips');
    await userEvent.click(tabs().getByRole('button', { name: /Add/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/|{"add":true}');
  });

  it('steps aside while a field has the keyboard up, and comes back after', () => {
    renderAt('/');
    const field = document.createElement('input');
    document.body.append(field);
    const bar = screen.getByRole('navigation', { name: 'Main' });
    expect(bar).toHaveClass('flex', 'md:hidden');
    act(() => field.focus());
    expect(bar).toHaveClass('hidden');
    expect(bar).not.toHaveClass('flex');
    // Its room goes with it (index.css sets --tab-bar to 0 then).
    expect(document.documentElement).toHaveAttribute('data-typing');
    act(() => field.blur());
    expect(bar).toHaveClass('flex');
    expect(document.documentElement).not.toHaveAttribute('data-typing');
    field.remove();
  });
});
