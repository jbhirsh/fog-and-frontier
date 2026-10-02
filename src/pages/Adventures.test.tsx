import { describe, expect, it } from 'vitest';
import { render as rtlRender } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { render, screen, toActivityRow } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createApolloCache } from '../lib/apolloClient';
import { ACTIVITIES_QUERY, COMPLETED_QUERY } from '../lib/gqlDocs';
import type { Activity } from '../data/types';
import { completedHike, muirWoods } from '../test/fixtures';

import { Adventures } from './Adventures';

function renderAdventures(list: Activity[]) {
  return render(
    <MemoryRouter>
      <Adventures />
    </MemoryRouter>,
    { activities: list },
  );
}

describe('Adventures page', () => {
  it('shows only completed activities', () => {
    renderAdventures([muirWoods, completedHike]);
    expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
  });

  it('shows the count in the header', () => {
    renderAdventures([muirWoods, completedHike]);
    expect(screen.getByText(/1 trip/)).toBeInTheDocument();
  });

  it('opens the detail dialog with the photo gallery for a completed activity', async () => {
    renderAdventures([completedHike]);
    await userEvent.click(
      screen.getByRole('button', { name: /Test Completed Hike/ }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // The Your Photos gallery (a read) renders for everyone; the owner-gated
    // "Add photos" upload control is hidden for non-owners (issue #67).
    expect(
      screen.getByRole('heading', { name: 'Your Photos' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Add photos')).not.toBeInTheDocument();
  });

  it('shows an empty state when no completed activities exist', () => {
    renderAdventures([muirWoods]);
    expect(screen.getByText(/No completed adventures yet/)).toBeInTheDocument();
  });

  it('sorts completed trips by date and tolerates missing dates', () => {
    const undated: Activity = {
      ...completedHike,
      id: 'undated',
      name: 'Undated Trip',
      completedDate: undefined,
    };
    const older: Activity = {
      ...completedHike,
      id: 'older',
      name: 'Older Trip',
      completedDate: '2024-01-01',
    };
    const newer: Activity = {
      ...completedHike,
      id: 'newer',
      name: 'Newer Trip',
      completedDate: '2026-04-01',
    };
    renderAdventures([undated, older, newer]);
    const cards = screen.getAllByRole('button');
    const labels = cards.map((b) => b.textContent ?? '');
    const newerIdx = labels.findIndex((l) => l.includes('Newer Trip'));
    const olderIdx = labels.findIndex((l) => l.includes('Older Trip'));
    const undatedIdx = labels.findIndex((l) => l.includes('Undated Trip'));
    expect(newerIdx).toBeLessThan(olderIdx);
    expect(olderIdx).toBeLessThan(undatedIdx);
  });

  it('closes the detail dialog when the close button is clicked', async () => {
    renderAdventures([completedHike]);
    await userEvent.click(
      screen.getByRole('button', { name: /Test Completed Hike/ }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the singular "trip" for exactly one completed activity', () => {
    renderAdventures([completedHike]);
    expect(screen.getByText(/^1 trip /)).toBeInTheDocument();
  });

  it('uses the plural "trips" for multiple completed activities', () => {
    renderAdventures([
      completedHike,
      { ...completedHike, id: 'second', name: 'Second' },
    ]);
    expect(screen.getByText(/^2 trips /)).toBeInTheDocument();
  });

  it('picks up a completion that lands after the first paint', async () => {
    // The cached read paints first; the cache-and-network refetch then reports
    // an activity completed elsewhere, and the page must follow it.
    const cache = createApolloCache();
    const activities = [toActivityRow(muirWoods)];
    cache.writeQuery({ query: ACTIVITIES_QUERY, data: { activities } });
    cache.writeQuery({ query: COMPLETED_QUERY, data: { completed: [] } });
    const mocks = [
      {
        request: { query: ACTIVITIES_QUERY },
        result: { data: { activities } },
      },
      {
        request: { query: COMPLETED_QUERY },
        result: {
          data: {
            completed: [
              {
                __typename: 'CompletedEntry' as const,
                id: muirWoods.id,
                completed: true,
              },
            ],
          },
        },
      },
    ];
    rtlRender(
      <MockedProvider cache={cache} mocks={mocks}>
        <MemoryRouter>
          <Adventures />
        </MemoryRouter>
      </MockedProvider>,
    );
    expect(screen.getByText(/No completed adventures yet/)).toBeInTheDocument();
    expect(await screen.findByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText(/^1 trip /)).toBeInTheDocument();
  });
});
