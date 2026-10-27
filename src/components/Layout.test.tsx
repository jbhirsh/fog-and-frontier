import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

// The header's links, apart from the phone's tab bar (#289), which repeats some.
function header() {
  return within(screen.getByRole('banner'));
}

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
    expect(header().getByRole('link', { name: 'Explore' })).toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Trips' })).toBeInTheDocument();
  });

  it('marks the Curated link active on the home route', () => {
    renderAt('/');
    // aria-current="page" is set by NavLink only on the active link, so this
    // distinguishes active from inactive (the inactive class also contains
    // `hover:text-secondary`, so a className substring match would not).
    const curated = header().getByRole('link', { name: 'Curated' });
    expect(curated).toHaveAttribute('aria-current', 'page');
    expect(header().getByRole('link', { name: 'Explore' })).not.toHaveAttribute('aria-current');
  });

  it('marks the Trips link active on /trips', () => {
    renderAt('/trips');
    expect(screen.getByText('trips-content')).toBeInTheDocument();
    const trips = header().getByRole('link', { name: 'Trips' });
    expect(trips).toHaveAttribute('aria-current', 'page');
  });

  // The Adventures tab is retired (#5): completed activities are the
  // catalog's "Completed only" filter now.
  it('has no Adventures tab', () => {
    renderAt('/');
    expect(header().queryByRole('link', { name: 'Adventures' })).not.toBeInTheDocument();
  });

  it('renders the brand and footer', () => {
    // The footer is suppressed on the catalog ("/") so the split view owns the
    // page scroll; assert it on another route.
    renderAt('/trips');
    expect(screen.getAllByText('Fog and Frontier').length).toBeGreaterThan(0);
    expect(screen.getByText(/Inspired by the Pacific Coast/)).toBeInTheDocument();
    // From md up only: on a phone the tab bar is the page's foot.
    expect(screen.getByRole('contentinfo')).toHaveClass('hidden', 'md:block');
    expect(screen.getByRole('contentinfo').className).not.toMatch(/safe-area/);
  });

  it('steps its bar aside on a phone only while a trip’s own header is up', () => {
    // Not by path: /trips/new, and a trip still loading or asking to sign
    // in, have no header of their own.
    for (const path of ['/trips/new', '/trips/t1', '/']) {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="*" element={<div>page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByRole('banner')).toHaveClass('in-data-own-header:max-md:hidden');
      expect(screen.getByRole('banner')).not.toHaveClass('max-md:hidden');
      cleanup();
    }
  });

  // Explore is an owner-only surface (#111): hidden, not greyed out.
  it('shows the Explore tab to the owner', () => {
    renderAt('/');
    expect(header().getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore');
  });

  it('hides the Explore tab from non-owners', () => {
    ownerState.isOwner = false;
    renderAt('/');
    expect(header().queryByRole('link', { name: 'Explore' })).not.toBeInTheDocument();
    // The rest of the nav is unaffected.
    expect(header().getByRole('link', { name: 'Curated' })).toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Trips' })).toBeInTheDocument();
  });

  // The mobile map is a full-screen backdrop (#96): on a tablet (md to lg)
  // the header drops its search and nav there; lg+ keeps them. A phone
  // keeps its one-line search (#289), and never shows the nav, whose links
  // are the tab bar's.
  it('collapses the header between md and lg on the map view only', () => {
    const { unmount } = renderAt('/?view=map');
    expect(screen.getByRole('search')).toHaveClass('md:max-lg:hidden');
    expect(header().getByRole('navigation')).toHaveClass('hidden', 'lg:flex');
    expect(header().getByRole('navigation')).not.toHaveClass('md:flex');
    unmount();

    renderAt('/?view=list');
    expect(screen.getByRole('search')).not.toHaveClass('md:max-lg:hidden');
    expect(header().getByRole('navigation')).toHaveClass('hidden', 'md:flex');
  });

  it('gives a phone the search and the account on the catalog, the brand elsewhere (#289)', () => {
    const { unmount } = renderAt('/');
    expect(header().getByRole('link', { name: 'Fog and Frontier' })).toHaveClass(
      'hidden',
      'md:block',
    );
    expect(screen.getByRole('search')).toHaveClass('flex-1', 'md:flex-none');
    unmount();
    renderAt('/trips');
    expect(header().getByRole('link', { name: 'Fog and Frontier' })).not.toHaveClass('hidden');
  });

  it('keeps the page clear of the phone’s tab bar (#289)', () => {
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByText('explore-content').closest('.pb-\\(--tab-bar\\)')).not.toBeNull();
  });
});
