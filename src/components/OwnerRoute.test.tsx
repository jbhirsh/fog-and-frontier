import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OwnerRoute } from './OwnerRoute';

const ownerState = vi.hoisted(() => ({ isOwner: false, isLoaded: true }));

vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({
    isOwner: ownerState.isOwner,
    isLoaded: ownerState.isLoaded,
    email: null,
  }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>home-content</div>} />
        <Route
          path="/owner-only"
          element={
            <OwnerRoute>
              <div>owner-content</div>
            </OwnerRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OwnerRoute', () => {
  beforeEach(() => {
    ownerState.isOwner = false;
    ownerState.isLoaded = true;
  });

  it('renders nothing (and does not redirect) while auth is loading', () => {
    ownerState.isLoaded = false;
    const { container } = renderAt('/owner-only');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading even for a forced owner', () => {
    ownerState.isLoaded = false;
    ownerState.isOwner = true;
    const { container } = renderAt('/owner-only');
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects a non-owner home', () => {
    renderAt('/owner-only');
    expect(screen.getByText('home-content')).toBeInTheDocument();
    expect(screen.queryByText('owner-content')).not.toBeInTheDocument();
  });

  it('renders the page for the owner', () => {
    ownerState.isOwner = true;
    renderAt('/owner-only');
    expect(screen.getByText('owner-content')).toBeInTheDocument();
    expect(screen.queryByText('home-content')).not.toBeInTheDocument();
  });
});
