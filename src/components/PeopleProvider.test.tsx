import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockedResponse } from '@apollo/client/testing';
import { PeopleProvider } from './PeopleProvider';
import { AuthCtx } from '../lib/authShim';
import { USERS_QUERY } from '../lib/gqlDocs';
import { usePersonLabel } from '../lib/people';

const TARUN = 'tarunkhubchandani@example.com';

function Probe() {
  const label = usePersonLabel();
  return <p>{[TARUN, 'jess.hirsh@example.com'].map((e) => label(e)).join(' / ')}</p>;
}

const users: MockedResponse = {
  request: { query: USERS_QUERY },
  result: {
    data: {
      users: [
        { __typename: 'User', email: TARUN, displayName: 'Tarun' },
        { __typename: 'User', email: 'jess.hirsh@example.com', displayName: null },
      ],
    },
  },
};

function signedIn(email: string | null) {
  return { isLoaded: true, email, name: null };
}

describe('PeopleProvider', () => {
  it('names the people it knows by first name for a signed-in account', async () => {
    render(
      <MockedProvider mocks={[users]}>
        <AuthCtx.Provider value={signedIn('jess.hirsh@example.com')}>
          <PeopleProvider>
            <Probe />
          </PeopleProvider>
        </AuthCtx.Provider>
      </MockedProvider>,
    );
    // Email names until the list loads, then first names where there are any.
    expect(screen.getByText('Tarunkhubchandani / Jess Hirsh')).toBeInTheDocument();
    expect(await screen.findByText('Tarun / Jess Hirsh')).toBeInTheDocument();
  });

  it('asks for no one, naming by email, for a signed-out visitor', async () => {
    // No mock: a request would fail the query and log, but none is made.
    render(
      <MockedProvider mocks={[]}>
        <AuthCtx.Provider value={signedIn(null)}>
          <PeopleProvider>
            <Probe />
          </PeopleProvider>
        </AuthCtx.Provider>
      </MockedProvider>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('Tarunkhubchandani / Jess Hirsh')).toBeInTheDocument();
  });

  it('names by email with no provider at all', () => {
    render(<Probe />);
    expect(screen.getByText('Tarunkhubchandani / Jess Hirsh')).toBeInTheDocument();
  });
});
