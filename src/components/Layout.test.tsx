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
    const curated = screen.getByRole('link', { name: 'Curated' });
    expect(curated.className).toMatch(/text-secondary/);
  });

  it('marks the Adventures link active on /adventures', () => {
    renderAt('/adventures');
    expect(screen.getByText('adv-content')).toBeInTheDocument();
    const adv = screen.getByRole('link', { name: 'Adventures' });
    expect(adv.className).toMatch(/text-secondary/);
  });

  it('renders the brand and footer', () => {
    // The footer is suppressed on the catalog ("/") so the split view owns the
    // page scroll; assert it on another route.
    renderAt('/adventures');
    expect(screen.getAllByText('Fog and Frontier').length).toBeGreaterThan(0);
    expect(screen.getByText(/Inspired by the Pacific Coast/)).toBeInTheDocument();
  });
});
