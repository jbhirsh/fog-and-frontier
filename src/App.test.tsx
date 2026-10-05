import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from './test/render';
import { muirWoods } from './test/fixtures';

import App from './App';

describe('App', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders Curated Adventures at the root route', () => {
    render(<App />, { activities: [muirWoods] });
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });

  // Explore is owner-only (#111). The default test auth is a loaded,
  // signed-out visitor, so a direct visit is redirected home.
  it('redirects a non-owner from /explore to the catalog', async () => {
    window.history.replaceState(null, '', '/explore');
    render(<App />, { activities: [muirWoods] });
    expect(await screen.findByText('Curated Adventures')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
