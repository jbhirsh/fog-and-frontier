import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromoteToPlanningModal } from './PromoteToPlanningModal';
import type { TripActivity } from '../lib/userTrips';

function makeCandidate(
  id: string,
  name: string,
  net: number,
  up: number,
  down: number,
): { activity: TripActivity; tally: { up: number; down: number; net: number } } {
  const activity: TripActivity = {
    id,
    trip_id: 'trip-1',
    activity_id: null,
    added_by_email: 'test@example.com',
    added_at: 0,
    day_index: null,
    start_time: null,
    display_order: 0,
    snapshot: {
      id,
      name,
      shortDescription: '',
      category: 'hiking',
      region: 'sf',
      duration: 'Half Day',
      difficulty: 'easy',
      location: { city: 'SF', coords: { lat: 37, lng: -122 } },
      coverImage: '',
    },
  };
  return { activity, tally: { up, down, net } };
}

const positiveA = makeCandidate('a1', 'Muir Woods', 3, 4, 1);
const positiveB = makeCandidate('b2', 'Stinson Beach', 1, 2, 1);
const neutralC = makeCandidate('c3', 'Alcatraz', 0, 2, 2);
const negativeD = makeCandidate('d4', 'Candlestick Park', -2, 1, 3);

const candidates = [positiveA, positiveB, neutralC, negativeD];

describe('PromoteToPlanningModal', () => {
  it('positive-net candidates are pre-checked', () => {
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: /Muir Woods/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Stinson Beach/i }),
    ).toBeChecked();
  });

  it('zero-net and negative-net candidates are NOT pre-checked', () => {
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: /Alcatraz/i }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Candlestick Park/i }),
    ).not.toBeChecked();
  });

  it('confirming with defaults calls onConfirm with only positive-net ids in order', async () => {
    const onConfirm = vi.fn();
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Move to planning/i }));
    expect(onConfirm).toHaveBeenCalledWith(['a1', 'b2']);
  });

  it('toggling a negative candidate then confirming includes it in the result', async () => {
    const onConfirm = vi.fn();
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Candlestick Park/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Move to planning/i }));
    expect(onConfirm).toHaveBeenCalledWith(['a1', 'b2', 'd4']);
  });

  it('toggling a positive candidate off excludes it from the result', async () => {
    const onConfirm = vi.fn();
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Muir Woods/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Move to planning/i }));
    expect(onConfirm).toHaveBeenCalledWith(['b2']);
  });

  it('Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('backdrop click calls onCancel', async () => {
    const onCancel = vi.fn();
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Close dialog/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('result ids are in candidates order, not toggle order', async () => {
    const onConfirm = vi.fn();
    render(
      <PromoteToPlanningModal
        candidates={candidates}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    // Toggle neutral and negative on first, then toggle off positiveB
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Alcatraz/i }),
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Candlestick Park/i }),
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Stinson Beach/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Move to planning/i }));
    // Order should be: a1, c3, d4 (candidates array order, b2 excluded)
    expect(onConfirm).toHaveBeenCalledWith(['a1', 'c3', 'd4']);
  });
});
