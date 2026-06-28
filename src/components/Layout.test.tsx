import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';

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
});
