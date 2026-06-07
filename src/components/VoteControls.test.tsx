import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoteControls } from './VoteControls';

const baseTally = { up: 3, down: 1, net: 2 };

describe('VoteControls', () => {
  it('shows net score pill with correct value', () => {
    render(<VoteControls tally={baseTally} myVote={0} />);
    expect(screen.getByLabelText('Net score +2')).toBeInTheDocument();
  });

  it('shows net score with minus sign when negative', () => {
    render(<VoteControls tally={{ up: 1, down: 4, net: -3 }} myVote={0} />);
    expect(screen.getByLabelText('Net score -3')).toBeInTheDocument();
  });

  it('shows 0 net score', () => {
    render(<VoteControls tally={{ up: 2, down: 2, net: 0 }} myVote={0} />);
    expect(screen.getByLabelText('Net score 0')).toBeInTheDocument();
  });

  it('clicking inactive upvote calls onVote(1)', async () => {
    const onVote = vi.fn();
    render(<VoteControls tally={baseTally} myVote={0} onVote={onVote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Upvote' }));
    expect(onVote).toHaveBeenCalledWith(1);
  });

  it('clicking active upvote calls onVote(0) — toggles off', async () => {
    const onVote = vi.fn();
    render(<VoteControls tally={baseTally} myVote={1} onVote={onVote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Upvote' }));
    expect(onVote).toHaveBeenCalledWith(0);
  });

  it('clicking inactive downvote calls onVote(-1)', async () => {
    const onVote = vi.fn();
    render(<VoteControls tally={baseTally} myVote={0} onVote={onVote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Downvote' }));
    expect(onVote).toHaveBeenCalledWith(-1);
  });

  it('clicking active downvote calls onVote(0) — toggles off', async () => {
    const onVote = vi.fn();
    render(<VoteControls tally={baseTally} myVote={-1} onVote={onVote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Downvote' }));
    expect(onVote).toHaveBeenCalledWith(0);
  });

  it('aria-pressed reflects myVote for upvote', () => {
    const { rerender } = render(<VoteControls tally={baseTally} myVote={1} />);
    expect(screen.getByRole('button', { name: 'Upvote' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Downvote' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(<VoteControls tally={baseTally} myVote={-1} />);
    expect(screen.getByRole('button', { name: 'Upvote' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Downvote' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('aria-pressed is false on both when myVote is 0', () => {
    render(<VoteControls tally={baseTally} myVote={0} />);
    expect(screen.getByRole('button', { name: 'Upvote' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Downvote' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('disabled renders both buttons disabled', () => {
    render(
      <VoteControls
        tally={baseTally}
        myVote={0}
        disabled
        disabledTooltip="Voting is closed"
      />,
    );
    expect(screen.getByRole('button', { name: 'Upvote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Downvote' })).toBeDisabled();
  });

  it('disabled — clicking does not call onVote', async () => {
    const onVote = vi.fn();
    render(
      <VoteControls
        tally={baseTally}
        myVote={0}
        disabled
        disabledTooltip="Voting is closed"
        onVote={onVote}
      />,
    );
    // userEvent.click on a disabled button does not fire click events
    await userEvent.click(screen.getByRole('button', { name: 'Upvote' }));
    await userEvent.click(screen.getByRole('button', { name: 'Downvote' }));
    expect(onVote).not.toHaveBeenCalled();
  });

  it('disabled buttons carry the disabledTooltip as title', () => {
    render(
      <VoteControls
        tally={baseTally}
        myVote={0}
        disabled
        disabledTooltip="Voting is closed"
      />,
    );
    expect(screen.getByRole('button', { name: 'Upvote' })).toHaveAttribute(
      'title',
      'Voting is closed',
    );
    expect(screen.getByRole('button', { name: 'Downvote' })).toHaveAttribute(
      'title',
      'Voting is closed',
    );
  });
});
