import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MembersStrip } from './MembersStrip';
import type { TripMember, TripInvite } from '../lib/userTrips';

const CREATOR: TripMember = {
  email: 'alice@example.com',
  display_name: 'Alice',
  added_by_email: 'alice@example.com',
  added_at: 0,
  is_creator: true,
};

const MEMBER: TripMember = {
  email: 'bob@example.com',
  display_name: 'Bob',
  added_by_email: 'alice@example.com',
  added_at: 1,
  is_creator: false,
};

const INVITE: TripInvite = {
  invite_token: 'tok-123',
  invited_email: 'carol@example.com',
  invited_by_email: 'alice@example.com',
  invited_at: 2,
};

function defaultProps(overrides: Partial<Parameters<typeof MembersStrip>[0]> = {}) {
  return {
    members: [CREATOR, MEMBER],
    invites: [INVITE],
    currentEmail: 'alice@example.com',
    isCreator: true,
    onInvite: vi.fn(),
    onRemoveMember: vi.fn(),
    onRevokeInvite: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

describe('MembersStrip', () => {
  it('renders member chips with display names', () => {
    render(<MembersStrip {...defaultProps()} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it('renders the Creator badge on the creator chip', () => {
    render(<MembersStrip {...defaultProps()} />);
    expect(screen.getByText('Creator')).toBeInTheDocument();
  });

  it('renders the You hint on the current user\'s chip', () => {
    render(<MembersStrip {...defaultProps({ currentEmail: 'alice@example.com' })} />);
    expect(screen.getByText(/· You/)).toBeInTheDocument();
  });

  it('renders a pending invite chip with the invited email', () => {
    render(<MembersStrip {...defaultProps()} />);
    expect(screen.getByText('carol@example.com')).toBeInTheDocument();
  });

  it('renders "pending invite" when invited_email is null', () => {
    const invite: TripInvite = { ...INVITE, invited_email: null };
    render(<MembersStrip {...defaultProps({ invites: [invite] })} />);
    expect(screen.getByText('pending invite')).toBeInTheDocument();
  });

  it('remove ✕ on non-creator member is ENABLED when isCreator=true', async () => {
    const onRemoveMember = vi.fn();
    render(
      <MembersStrip
        {...defaultProps({ isCreator: true, onRemoveMember })}
      />,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove bob@example.com' });
    expect(removeBtn).not.toBeDisabled();
    await userEvent.click(removeBtn);
    expect(onRemoveMember).toHaveBeenCalledWith('bob@example.com');
  });

  it('remove ✕ on non-creator member is DISABLED with tooltip when isCreator=false', () => {
    render(
      <MembersStrip
        {...defaultProps({ isCreator: false, currentEmail: 'alice@example.com' })}
      />,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove bob@example.com' });
    expect(removeBtn).toBeDisabled();
    expect(removeBtn).toHaveAttribute(
      'title',
      'Only the trip creator can remove members',
    );
  });

  it('clicking revoke calls onRevokeInvite with the invite token', async () => {
    const onRevokeInvite = vi.fn();
    render(<MembersStrip {...defaultProps({ onRevokeInvite })} />);
    const revokeBtn = screen.getByRole('button', {
      name: 'Revoke invite for carol@example.com',
    });
    await userEvent.click(revokeBtn);
    expect(onRevokeInvite).toHaveBeenCalledWith('tok-123');
  });

  it('shows Leave trip button for non-creator current member and calls onLeave', async () => {
    const onLeave = vi.fn();
    render(
      <MembersStrip
        {...defaultProps({
          currentEmail: 'bob@example.com',
          isCreator: false,
          onLeave,
        })}
      />,
    );
    const leaveBtn = screen.getByRole('button', { name: 'Leave trip' });
    expect(leaveBtn).toBeInTheDocument();
    await userEvent.click(leaveBtn);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('does NOT show Leave trip button for the creator', () => {
    render(
      <MembersStrip
        {...defaultProps({ currentEmail: 'alice@example.com', isCreator: true })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Leave trip' })).not.toBeInTheDocument();
  });

  it('clicking + Invite calls onInvite', async () => {
    const onInvite = vi.fn();
    render(<MembersStrip {...defaultProps({ onInvite })} />);
    await userEvent.click(screen.getByRole('button', { name: /\+ Invite/i }));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('does not show a remove ✕ on the current user\'s own chip', () => {
    render(
      <MembersStrip
        {...defaultProps({ currentEmail: 'bob@example.com', isCreator: true })}
      />,
    );
    // Bob's chip should not have a remove button
    expect(
      screen.queryByRole('button', { name: 'Remove bob@example.com' }),
    ).not.toBeInTheDocument();
  });
});
