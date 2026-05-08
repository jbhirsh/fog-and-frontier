import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Activity } from '../data/types';
import { completedHike, muirWoods } from '../test/fixtures';

let mockList: Activity[] = [];

vi.mock('../data/activities', () => ({
  get activities() {
    return mockList;
  },
}));

import { Adventures } from './Adventures';

function renderAdventures() {
  return render(
    <MemoryRouter>
      <Adventures />
    </MemoryRouter>,
  );
}

describe('Adventures page', () => {
  beforeEach(() => {
    mockList = [muirWoods, completedHike];
  });

  it('shows only completed activities', () => {
    renderAdventures();
    expect(screen.getByText('Test Completed Hike')).toBeInTheDocument();
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
  });

  it('shows the count in the header', () => {
    renderAdventures();
    expect(screen.getByText(/1 trip/)).toBeInTheDocument();
  });

  it('opens the detail dialog with upload UI for a completed activity', async () => {
    mockList = [completedHike];
    renderAdventures();
    await userEvent.click(
      screen.getByRole('button', { name: /Test Completed Hike/ }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add photos')).toBeInTheDocument();
  });

  it('shows an empty state when no completed activities exist', () => {
    mockList = [muirWoods];
    renderAdventures();
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
    mockList = [undated, older, newer];
    renderAdventures();
    const cards = screen.getAllByRole('button');
    const labels = cards.map((b) => b.textContent ?? '');
    const newerIdx = labels.findIndex((l) => l.includes('Newer Trip'));
    const olderIdx = labels.findIndex((l) => l.includes('Older Trip'));
    const undatedIdx = labels.findIndex((l) => l.includes('Undated Trip'));
    expect(newerIdx).toBeLessThan(olderIdx);
    expect(olderIdx).toBeLessThan(undatedIdx);
  });

  it('closes the detail dialog when the close button is clicked', async () => {
    mockList = [completedHike];
    renderAdventures();
    await userEvent.click(
      screen.getByRole('button', { name: /Test Completed Hike/ }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the singular "trip" for exactly one completed activity', () => {
    mockList = [completedHike];
    renderAdventures();
    expect(screen.getByText(/^1 trip /)).toBeInTheDocument();
  });

  it('uses the plural "trips" for multiple completed activities', () => {
    mockList = [
      completedHike,
      { ...completedHike, id: 'second', name: 'Second' },
    ];
    renderAdventures();
    expect(screen.getByText(/^2 trips /)).toBeInTheDocument();
  });
});
