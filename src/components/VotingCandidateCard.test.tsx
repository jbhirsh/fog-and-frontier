import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TripActivity } from '../lib/userTrips';
import { muirWoods } from '../test/fixtures';
import { VotingCandidateCard } from './VotingCandidateCard';
import { getIcon, queryIcon } from '../test/icons';

const candidate: TripActivity = {
  id: 'ta-1',
  trip_id: 'trip-1',
  activity_id: muirWoods.id,
  added_by_email: 'jess@example.com',
  added_at: 0,
  day_index: null,
  start_time: null,
  display_order: 0,
  snapshot: muirWoods,
};

const tally = { up: 2, down: 1, net: 1 };

type Props = Parameters<typeof VotingCandidateCard>[0];

function renderCard(over: Partial<Props> = {}) {
  const props: Props = {
    activity: candidate,
    tally,
    myVote: 0,
    votingOpen: true,
    canRemove: false,
    ...over,
  };
  const utils = render(<VotingCandidateCard {...props} />);
  // The card's outer box, which takes the drag events.
  const card = utils.container.firstElementChild as HTMLElement;
  return { card, ...utils };
}

const dragHandlers = () => ({
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDrop: vi.fn(),
});

describe('VotingCandidateCard', () => {
  it('shows the place, its city and duration, and the tally', () => {
    renderCard();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Mill Valley, CA · Half Day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upvote' })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Downvote' })).toHaveTextContent('1');
    expect(screen.queryByText('Original activity was deleted.')).not.toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', muirWoods.coverImage);
  });

  it('opens the place from its body', async () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    await userEvent.click(screen.getByRole('button', { name: /Test Muir Woods/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('is not a button without onOpen', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /Test Muir Woods/ })).not.toBeInTheDocument();
  });

  it('shows a deleted place by name only, never as a link', () => {
    const onOpen = vi.fn();
    const { card } = renderCard({ activity: { ...candidate, snapshot: null }, onOpen });
    expect(screen.getByText('(deleted activity)')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('·');
    expect(screen.getByText('Original activity was deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deleted activity/ })).not.toBeInTheDocument();
  });

  it('votes while voting is open', async () => {
    const onVote = vi.fn();
    renderCard({ myVote: 1, onVote });
    const up = screen.getByRole('button', { name: 'Upvote' });
    expect(up).toBeEnabled();
    expect(up).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(up);
    expect(onVote).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('closes the vote once voting is closed', async () => {
    const onVote = vi.fn();
    renderCard({ votingOpen: false, onVote });
    const up = screen.getByRole('button', { name: 'Upvote' });
    expect(up).toBeDisabled();
    expect(up).toHaveAttribute('title', 'Voting is closed');
    await userEvent.click(up);
    expect(onVote).not.toHaveBeenCalled();
  });

  it('offers Remove only to who can remove, with a handler', async () => {
    const onRemove = vi.fn();
    const { unmount } = renderCard({ canRemove: true, onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'Remove candidate' }));
    expect(onRemove).toHaveBeenCalledOnce();
    unmount();

    renderCard({ canRemove: false, onRemove }).unmount();
    expect(screen.queryByRole('button', { name: 'Remove candidate' })).not.toBeInTheDocument();
    renderCard({ canRemove: true });
    expect(screen.queryByRole('button', { name: 'Remove candidate' })).not.toBeInTheDocument();
  });

  it('drags to reorder while voting is open', () => {
    const handlers = dragHandlers();
    const { card } = renderCard({ draggable: true, ...handlers });
    expect(card).toHaveAttribute('draggable', 'true');
    expect(card).toHaveClass('cursor-grab');
    expect(getIcon('drag_indicator')).toHaveStyle({ fontSize: '20px' });
    fireEvent.dragStart(card);
    fireEvent.dragOver(card);
    fireEvent.drop(card);
    expect(handlers.onDragStart).toHaveBeenCalledOnce();
    expect(handlers.onDragOver).toHaveBeenCalledOnce();
    expect(handlers.onDrop).toHaveBeenCalledOnce();
  });

  it.each([
    ['voting is closed', { votingOpen: false, draggable: true }],
    ['the card is not draggable', { votingOpen: true, draggable: false }],
  ])('does not drag when %s', (_, over) => {
    const handlers = dragHandlers();
    const { card } = renderCard({ ...over, ...handlers });
    expect(card).toHaveAttribute('draggable', 'false');
    expect(card).not.toHaveClass('cursor-grab');
    expect(queryIcon('drag_indicator')).toBeNull();
    fireEvent.dragStart(card);
    fireEvent.dragOver(card);
    fireEvent.drop(card);
    expect(handlers.onDragStart).not.toHaveBeenCalled();
    expect(handlers.onDragOver).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });
});
