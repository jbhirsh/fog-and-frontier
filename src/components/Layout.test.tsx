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
          <Route path="/adventures" element={<div>adv-content</div>} />
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
    expect(screen.getByRole('link', { name: 'Adventures' })).toBeInTheDocument();
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

  it('marks the Adventures link active on /adventures', () => {
    renderAt('/adventures');
    expect(screen.getByText('adv-content')).toBeInTheDocument();
    const adv = screen.getByRole('link', { name: 'Adventures' });
    expect(adv).toHaveAttribute('aria-current', 'page');
  });

  it('renders the brand and footer', () => {
    // The footer is suppressed on the catalog ("/") so the split view owns the
    // page scroll; assert it on another route.
    renderAt('/adventures');
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
});
