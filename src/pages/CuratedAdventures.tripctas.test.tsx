import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InitialEntry } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import { muirWoods } from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

// Trip CTAs (#112): hidden — not greyed out — from signed-out visitors, and
// the per-card "Add to trip" control appears only while building a trip.

const SIGNED_IN: AuthState = {
  isLoaded: true,
  // A signed-in non-owner: adding to a trip is a member power (#51).
  email: 'editor@example.com',
  getToken: () => Promise.resolve(null),
};
const SIGNED_OUT: AuthState = { ...SIGNED_IN, email: null };

const TARGET_ENTRY: InitialEntry = {
  pathname: '/',
  state: { target_trip_id: 'trip-1', target_trip_title: 'Big Sur' },
};

function renderAs(auth: AuthState, entry: InitialEntry = '/') {
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <CuratedAdventures />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods] },
  );
}

// The per-card control lives in the card's action slot; scope to the card so
// the selection bar's own "Add to trip" button isn't counted.
function cardAddToTrip(container: HTMLElement) {
  const card = container.querySelector<HTMLElement>(
    `[data-activity-id="${muirWoods.id}"]`,
  );
  if (!card) throw new Error('card not rendered');
  return within(card).queryByRole('button', { name: 'Add to trip' });
}

describe('Curated Adventures — trip CTAs (#112)', () => {
  it('shows neither trip CTA to a signed-out visitor', () => {
    const { container } = renderAs(SIGNED_OUT);
    expect(
      screen.queryByRole('button', { name: /Select for trip/ }),
    ).not.toBeInTheDocument();
    expect(cardAddToTrip(container)).not.toBeInTheDocument();
    // No disabled "Sign in to…" variant is left behind.
    expect(screen.queryByTitle(/Sign in to/)).not.toBeInTheDocument();
  });

  it('ignores a trip target for a signed-out visitor', () => {
    const { container } = renderAs(SIGNED_OUT, TARGET_ENTRY);
    expect(cardAddToTrip(container)).not.toBeInTheDocument();
    expect(screen.queryByText(/Adding to/)).not.toBeInTheDocument();
  });

  it('offers "Select for trip" but no per-card control while browsing', () => {
    const { container } = renderAs(SIGNED_IN);
    expect(
      screen.getByRole('button', { name: /Select for trip/ }),
    ).toBeEnabled();
    expect(cardAddToTrip(container)).not.toBeInTheDocument();
  });

  it('shows the per-card control in selection mode, and hides it on cancel', async () => {
    const { container } = renderAs(SIGNED_IN);
    await userEvent.click(
      screen.getByRole('button', { name: /Select for trip/ }),
    );
    expect(cardAddToTrip(container)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Cancel select/ }),
    );
    expect(cardAddToTrip(container)).not.toBeInTheDocument();
  });

  it('leaves selection mode when the user signs out mid-select', async () => {
    function Harness() {
      const [auth, setAuth] = useState(SIGNED_IN);
      return (
        <AuthCtx.Provider value={auth}>
          <button type="button" onClick={() => setAuth(SIGNED_OUT)}>
            test sign out
          </button>
          <MemoryRouter>
            <CuratedAdventures />
          </MemoryRouter>
        </AuthCtx.Provider>
      );
    }
    const { container } = render(<Harness />, { activities: [muirWoods] });
    await userEvent.click(
      screen.getByRole('button', { name: /Select for trip/ }),
    );
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'test sign out' }));
    expect(screen.queryByText(/0 selected/)).not.toBeInTheDocument();
    expect(cardAddToTrip(container)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Cancel select/ }),
    ).not.toBeInTheDocument();
  });

  it('applies a trip target once auth finishes loading', () => {
    // Clerk resolves the session after the first render; a reload keeps
    // location.state, so the target must survive that.
    const loading: AuthState = { ...SIGNED_OUT, isLoaded: false };
    function page(auth: AuthState) {
      return (
        <AuthCtx.Provider value={auth}>
          <MemoryRouter initialEntries={[TARGET_ENTRY]}>
            <CuratedAdventures />
          </MemoryRouter>
        </AuthCtx.Provider>
      );
    }
    const { container, rerender } = render(page(loading), {
      activities: [muirWoods],
    });
    expect(screen.queryByText(/Adding to/)).not.toBeInTheDocument();

    rerender(page(SIGNED_IN));
    expect(screen.getByText(/Adding to/)).toHaveTextContent('Big Sur');
    expect(cardAddToTrip(container)).toBeInTheDocument();
  });

  it('starts fresh after signing out and back in', async () => {
    function Harness() {
      const [auth, setAuth] = useState(SIGNED_IN);
      return (
        <AuthCtx.Provider value={auth}>
          <button type="button" onClick={() => setAuth(SIGNED_OUT)}>
            test sign out
          </button>
          <button type="button" onClick={() => setAuth(SIGNED_IN)}>
            test sign in
          </button>
          <MemoryRouter>
            <CuratedAdventures />
          </MemoryRouter>
        </AuthCtx.Provider>
      );
    }
    const { container } = render(<Harness />, { activities: [muirWoods] });
    await userEvent.click(
      screen.getByRole('button', { name: /Select for trip/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'test sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'test sign in' }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(cardAddToTrip(container)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Select for trip/ }),
    ).toBeInTheDocument();
  });

  it('shows the per-card control when arriving with a trip target', () => {
    const { container } = renderAs(SIGNED_IN, TARGET_ENTRY);
    expect(screen.getByText(/Adding to/)).toHaveTextContent('Big Sur');
    expect(cardAddToTrip(container)).toBeInTheDocument();
  });
});
