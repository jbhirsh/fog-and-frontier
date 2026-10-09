import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from './test/render';
import { dogFriendlyTidepools, muirWoods } from './test/fixtures';

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

  // The Adventures page is retired (#5); its URL now lands on the catalog's
  // "Completed only" filter.
  it('redirects /adventures to the completed-only catalog', async () => {
    window.history.replaceState(null, '', '/adventures');
    render(<App />, { activities: [muirWoods] });
    expect(await screen.findByText('Curated Adventures')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?completed=1');
    expect(
      screen.getByRole('switch', { name: 'Completed only' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  // Activity permalinks (#86).
  it('opens a linked activity over the catalog', () => {
    window.history.replaceState(null, '', `/activity/${muirWoods.id}`);
    render(<App />, { activities: [muirWoods, dogFriendlyTidepools] });
    expect(
      screen.getByRole('dialog', { name: 'Test Muir Woods' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/activity/${muirWoods.id}`);
  });

  it('puts an opened card in the URL, and Back closes it', async () => {
    render(<App />, { activities: [muirWoods, dogFriendlyTidepools] });
    await userEvent.click(
      screen.getByRole('button', { name: /Test Tide Pools/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Test Tide Pools')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/activity/${dogFriendlyTidepools.id}`);

    window.history.back();
    await screen.findByText('Curated Adventures');
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull();
    expect(window.location.pathname).toBe('/');
  });
});
