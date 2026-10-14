import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import { muirWoods } from '../test/fixtures';

import { CuratedAdventures } from './CuratedAdventures';

// The catalog's add entry (#73): owners add an activity, any other signed-in
// account suggests one for them to review, and signed-out visitors see
// neither (hidden, not greyed out).

const SIGNED_IN: AuthState = {
  isLoaded: true,
  email: 'friend@example.com',
  getToken: () => Promise.resolve(null),
};
const SIGNED_OUT: AuthState = { ...SIGNED_IN, email: null };

type ForceOwner = { __TEST_FORCE_OWNER__?: boolean };

afterEach(() => {
  delete (window as ForceOwner).__TEST_FORCE_OWNER__;
});

function renderAs(auth: AuthState) {
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods] },
  );
}

describe('Curated Adventures — add or suggest (#73)', () => {
  it('shows a signed-out visitor neither', () => {
    renderAs(SIGNED_OUT);
    expect(screen.queryByRole('button', { name: /Add activity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suggest activity/ })).not.toBeInTheDocument();
  });

  it('offers a signed-in non-owner "Suggest activity", which opens the suggest dialog', async () => {
    renderAs(SIGNED_IN);
    expect(screen.queryByRole('button', { name: /Add activity/ })).not.toBeInTheDocument();
    // Its lightbulb is pulled out by its own side bearing, not the add icon's.
    const icon = screen
      .getByRole('button', { name: /Suggest activity/ })
      .querySelector<HTMLElement>('.material-symbols-outlined');
    expect(icon).toHaveTextContent('lightbulb');
    expect(icon?.style.marginLeft).toBe('-0.167em');
    await userEvent.click(screen.getByRole('button', { name: /Suggest activity/ }));
    expect(screen.getByRole('dialog', { name: 'Suggest activity' })).toBeInTheDocument();
  });

  it('offers "Add activity" to an owner whose email is not known yet', () => {
    // The visual specs force the owner flag alone.
    (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
    renderAs(SIGNED_OUT);
    expect(screen.getByRole('button', { name: /Add activity/ })).toBeInTheDocument();
  });

  it('offers an owner "Add activity", which opens the add dialog', async () => {
    (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
    renderAs(SIGNED_IN);
    expect(screen.queryByRole('button', { name: /Suggest activity/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add activity/ }));
    expect(screen.getByRole('dialog', { name: 'Add activity' })).toBeInTheDocument();
  });
});
