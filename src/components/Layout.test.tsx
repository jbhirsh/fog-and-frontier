import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';

const ownerState = vi.hoisted(() => ({ isOwner: true }));

vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({
    isOwner: ownerState.isOwner,
    isLoaded: true,
    email: null,
  }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>explore-content</div>} />
          <Route path="/trips" element={<div>trips-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout', () => {
  beforeEach(() => {
    ownerState.isOwner = true;
  });

  it('renders nav links and the routed child', () => {
    renderAt('/');
    expect(screen.getByText('explore-content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trips' })).toBeInTheDocument();
  });

  it('marks the Curated link active on the home route', () => {
    renderAt('/');
    // aria-current="page" is set by NavLink only on the active link, so this
    // distinguishes active from inactive (the inactive class also contains
    // `hover:text-secondary`, so a className substring match would not).
    const curated = screen.getByRole('link', { name: 'Curated' });
    expect(curated).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('link', { name: 'Explore' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('marks the Trips link active on /trips', () => {
    renderAt('/trips');
    expect(screen.getByText('trips-content')).toBeInTheDocument();
    const trips = screen.getByRole('link', { name: 'Trips' });
    expect(trips).toHaveAttribute('aria-current', 'page');
  });

  // The Adventures tab is retired (#5): completed activities are the
  // catalog's "Completed only" filter now.
  it('has no Adventures tab', () => {
    renderAt('/');
    expect(
      screen.queryByRole('link', { name: 'Adventures' }),
    ).not.toBeInTheDocument();
  });

  it('renders the brand and footer', () => {
    // The footer is suppressed on the catalog ("/") so the split view owns the
    // page scroll; assert it on another route.
    renderAt('/trips');
    expect(screen.getAllByText('Fog and Frontier').length).toBeGreaterThan(0);
    expect(screen.getByText(/Inspired by the Pacific Coast/)).toBeInTheDocument();
  });

  // Explore is an owner-only surface (#111): hidden, not greyed out.
  it('shows the Explore tab to the owner', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/explore',
    );
  });

  it('hides the Explore tab from non-owners', () => {
    ownerState.isOwner = false;
    renderAt('/');
    expect(
      screen.queryByRole('link', { name: 'Explore' }),
    ).not.toBeInTheDocument();
    // The rest of the nav is unaffected.
    expect(screen.getByRole('link', { name: 'Curated' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trips' })).toBeInTheDocument();
  });

  // The mobile map is a full-screen backdrop (#96): below `lg` the header
  // drops its search and nav rows there; lg+ (`lg:` classes) keeps them.
  it('collapses the header below lg on the map view only', () => {
    const { unmount } = renderAt('/?view=map');
    expect(screen.getByRole('search')).toHaveClass('hidden', 'lg:block');
    expect(screen.getByRole('navigation')).toHaveClass('hidden', 'lg:flex');
    unmount();

    renderAt('/?view=list');
    expect(screen.getByRole('search')).not.toHaveClass('hidden');
    expect(screen.getByRole('navigation')).not.toHaveClass('hidden');
  });
});
