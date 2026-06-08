import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteModal } from './InviteModal';

const USERS = [
  { email: 'alice@example.com', display_name: 'Alice' },
  { email: 'bob@example.com', display_name: null },
  { email: 'carol@example.com', display_name: 'Carol C' },
];

function defaultProps(overrides: Partial<Parameters<typeof InviteModal>[0]> = {}) {
  return {
    users: USERS,
    excludeEmails: [],
    onClose: vi.fn(),
    onCreateInvite: vi.fn().mockResolvedValue({ invite_token: 'tok' }),
    buildLink: (token: string) => `https://example.com/invite/${token}`,
    ...overrides,
  };
}

describe('InviteModal', () => {
  it('renders the modal with title and email input', () => {
    render(<InviteModal {...defaultProps()} />);
    expect(
      screen.getByRole('dialog', { name: 'Invite to this trip' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('typing filters suggestions from the user list', async () => {
    render(<InviteModal {...defaultProps()} />);
    await userEvent.type(screen.getByLabelText('Email address'), 'ali');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Carol C')).not.toBeInTheDocument();
  });

  it('excludes already-excluded emails from suggestions', async () => {
    render(
      <InviteModal
        {...defaultProps({ excludeEmails: ['alice@example.com'] })}
      />,
    );
    await userEvent.type(screen.getByLabelText('Email address'), 'ali');
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('clicking a suggestion fills the input', async () => {
    render(<InviteModal {...defaultProps()} />);
    const input = screen.getByLabelText('Email address');
    await userEvent.type(input, 'car');
    await userEvent.click(screen.getByText('Carol C'));
    expect(input).toHaveValue('carol@example.com');
  });

  it('shows an error and does NOT call onCreateInvite for an invalid email', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ invite_token: 'tok' });
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);
    await userEvent.type(screen.getByLabelText('Email address'), 'not-an-email');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create invite link' }),
    );
    expect(
      screen.getByText('Please enter a valid email address.'),
    ).toBeInTheDocument();
    expect(onCreateInvite).not.toHaveBeenCalled();
  });

  it('calls onCreateInvite with the email and shows the built link on success', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ invite_token: 'tok' });
    const buildLink = vi.fn((t: string) => `https://example.com/invite/${t}`);
    render(<InviteModal {...defaultProps({ onCreateInvite, buildLink })} />);

    await userEvent.type(
      screen.getByLabelText('Email address'),
      'new@example.com',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create invite link' }),
    );

    await waitFor(() => {
      expect(onCreateInvite).toHaveBeenCalledWith('new@example.com');
    });

    // Link-ready state shows the invite link in a readonly input
    const linkInput = await screen.findByDisplayValue(
      'https://example.com/invite/tok',
    );
    expect(linkInput).toBeInTheDocument();
    expect(linkInput).toHaveAttribute('readonly');

    // Copy link button present
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('"Invite someone else" resets back to the input state', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ invite_token: 'tok' });
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);

    await userEvent.type(
      screen.getByLabelText('Email address'),
      'new@example.com',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create invite link' }),
    );

    await screen.findByDisplayValue('https://example.com/invite/tok');

    await userEvent.click(
      screen.getByRole('button', { name: 'Invite someone else' }),
    );

    // Back to input state
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('closes when the backdrop button is clicked', async () => {
    const onClose = vi.fn();
    render(<InviteModal {...defaultProps({ onClose })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when onCreateInvite rejects', async () => {
    const onCreateInvite = vi
      .fn()
      .mockRejectedValue(new Error('Server error'));
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);

    await userEvent.type(
      screen.getByLabelText('Email address'),
      'bad@example.com',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create invite link' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });
});
