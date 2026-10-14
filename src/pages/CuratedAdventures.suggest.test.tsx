import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import { muirWoods } from '../test/fixtures';
import { PENDING_SUGGESTIONS } from '../lib/gqlDocs';

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

const pendingAnswer = vi.fn(() => ({
  data: {
      pendingSuggestions: [
        {
          __typename: 'ActivitySuggestion',
          id: 's1',
          suggestedBy: 'friend@example.com',
          suggestedAt: '2026-03-01T00:00:00.000Z',
          activity: {
            __typename: 'Activity',
            id: 's1',
            name: 'Fort Funston',
            shortDescription: 'Bluffs',
            longDescription: null,
            category: 'scenic',
            location: { __typename: 'Location', city: 'San Francisco' },
            duration: 'Half Day',
            costTier: null,
            coverImage: '',
            allTrailsUrl: null,
            reservationUrl: null,
            menuUrl: null,
            notes: null,
          },
        },
      ],
  },
}));
const PENDING = {
  request: { query: PENDING_SUGGESTIONS },
  result: pendingAnswer,
  maxUsageCount: Number.POSITIVE_INFINITY,
};

function renderAs(auth: AuthState) {
  return render(
    <AuthCtx.Provider value={auth}>
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>
    </AuthCtx.Provider>,
    { activities: [muirWoods], mocks: [PENDING] },
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

describe('Curated Adventures — the review queue (#73)', () => {
  it('shows owners what is waiting for review', async () => {
    (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
    renderAs(SIGNED_IN);
    expect(await screen.findByRole('region', { name: /Waiting for review/ })).toHaveTextContent(
      'Fort Funston',
    );
  });

  it('shows no one else a queue, or asks for one', async () => {
    pendingAnswer.mockClear();
    renderAs(SIGNED_IN);
    await screen.findByRole('button', { name: /Suggest activity/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: /Waiting for review/ })).not.toBeInTheDocument();
    expect(pendingAnswer).not.toHaveBeenCalled();
  });
});
