import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteModal } from './InviteModal';

// Clicks, then lets the handler's awaited promises settle.
function clickAndSettle(el: HTMLElement) {
  return act(() => {
    fireEvent.click(el);
    return Promise.resolve();
  });
}

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
    expect(screen.getByRole('dialog', { name: 'Invite to this trip' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('typing filters suggestions from the user list', async () => {
    render(<InviteModal {...defaultProps()} />);
    await userEvent.type(screen.getByLabelText('Email address'), 'ali');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Carol C')).not.toBeInTheDocument();
  });

  it('excludes already-excluded emails from suggestions', async () => {
    render(<InviteModal {...defaultProps({ excludeEmails: ['alice@example.com'] })} />);
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
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
    expect(onCreateInvite).not.toHaveBeenCalled();
  });

  it('calls onCreateInvite with the email and shows the built link on success', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ invite_token: 'tok' });
    const buildLink = vi.fn((t: string) => `https://example.com/invite/${t}`);
    render(<InviteModal {...defaultProps({ onCreateInvite, buildLink })} />);

    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => {
      expect(onCreateInvite).toHaveBeenCalledWith('new@example.com');
    });

    // Link-ready state shows the invite link in a readonly input
    const linkInput = await screen.findByDisplayValue('https://example.com/invite/tok');
    expect(linkInput).toBeInTheDocument();
    expect(linkInput).toHaveAttribute('readonly');

    // Copy link button present
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('"Invite someone else" resets back to the input state', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ invite_token: 'tok' });
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);

    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await screen.findByDisplayValue('https://example.com/invite/tok');

    await userEvent.click(screen.getByRole('button', { name: 'Invite someone else' }));

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
    const onCreateInvite = vi.fn().mockRejectedValue(new Error('Server error'));
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);

    await userEvent.type(screen.getByLabelText('Email address'), 'bad@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('matches by display name and email, ignoring case, and names a nameless user by email', async () => {
    render(<InviteModal {...defaultProps({ excludeEmails: ['CAROL@example.com'] })} />);
    const input = screen.getByLabelText('Email address');
    await userEvent.type(input, 'ALICE');
    expect(screen.getByRole('option', { name: /Alice/ })).toHaveTextContent('alice@example.com');
    await userEvent.clear(input);
    await userEvent.type(input, 'BOB@');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(/^bob@example\.com$/);
    // Carol is excluded whatever the case of her email.
    await userEvent.clear(input);
    await userEvent.type(input, 'carol');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('matches a part of a name that isn’t in the email, as an unselected option', async () => {
    render(<InviteModal {...defaultProps()} />);
    await userEvent.type(screen.getByLabelText('Email address'), 'OL C');
    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('Carol C');
    expect(option).toHaveAttribute('aria-selected', 'false');
  });

  it('suggests nothing for blank input', async () => {
    render(<InviteModal {...defaultProps()} />);
    // Not even Carol C, whose name has a space.
    await userEvent.type(screen.getByLabelText('Email address'), ' ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picking a suggestion closes the list and returns focus to the input', async () => {
    render(<InviteModal {...defaultProps()} />);
    const input = screen.getByLabelText('Email address');
    await userEvent.type(input, 'ali');
    await userEvent.click(screen.getByText('Alice'));
    expect(input).toHaveValue('alice@example.com');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('trims the email, and shows Creating… and ignores clicks while it waits', async () => {
    let resolve: (v: { invite_token: string }) => void = () => {};
    const onCreateInvite = vi.fn(
      () =>
        new Promise<{ invite_token: string }>((r) => {
          resolve = r;
        }),
    );
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);
    await userEvent.type(screen.getByLabelText('Email address'), '  new@example.com  ');
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    const busy = screen.getByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onCreateInvite).toHaveBeenCalledExactlyOnceWith('new@example.com');
    await act(() => {
      resolve({ invite_token: 'tok' });
      return Promise.resolve();
    });
    expect(screen.getByDisplayValue('https://example.com/invite/tok')).toBeInTheDocument();
  });

  it('offers to try again after a failure, with a generic message for a non-Error', async () => {
    const onCreateInvite = vi
      .fn()
      .mockRejectedValueOnce('nope')
      .mockResolvedValueOnce({ invite_token: 'tok' });
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);
    await userEvent.type(screen.getByLabelText('Email address'), 'bad@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create invite.');
    const create = screen.getByRole('button', { name: 'Create invite link' });
    expect(create).toBeEnabled();
    await userEvent.click(create);
    await screen.findByDisplayValue('https://example.com/invite/tok');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears an error on typing, or when dismissed', async () => {
    render(<InviteModal {...defaultProps()} />);
    const input = screen.getByLabelText('Email address');
    const create = screen.getByRole('button', { name: 'Create invite link' });
    await userEvent.click(create);
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    await userEvent.type(input, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(create);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['a@b', 'a b@c.d', '@b.c', 'a@.c', 'a@b.c d'])('refuses %j', async (bad) => {
    const onCreateInvite = vi.fn();
    render(<InviteModal {...defaultProps({ onCreateInvite })} />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: bad } });
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    expect(onCreateInvite).not.toHaveBeenCalled();
  });

  it('Cancel and Done both close', async () => {
    const onClose = vi.fn();
    render(<InviteModal {...defaultProps({ onClose })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('"Invite someone else" starts again from an empty field', async () => {
    render(<InviteModal {...defaultProps()} />);
    // Typed in full, so it is still the query when the link is made.
    await userEvent.type(screen.getByLabelText('Email address'), 'alice@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Invite someone else' }));
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  describe('copying the link', () => {
    // The clipboard as each test found it, put back after it.
    let ownClipboard: PropertyDescriptor | undefined;
    beforeEach(() => {
      ownClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    });
    afterEach(() => {
      if (ownClipboard) Object.defineProperty(navigator, 'clipboard', ownClipboard);
      else delete (navigator as { clipboard?: Clipboard }).clipboard;
    });

    function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    }

    async function linkReady() {
      render(<InviteModal {...defaultProps()} />);
      await userEvent.type(screen.getByLabelText('Email address'), 'new@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
      return screen.findByRole('button', { name: 'Copy link' });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('copies the link, says so for two seconds, and resets on inviting again', async () => {
      const copy = await linkReady();
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard({ writeText });
      vi.useFakeTimers();
      await clickAndSettle(copy);
      expect(writeText).toHaveBeenCalledExactlyOnceWith('https://example.com/invite/tok');
      expect(copy).toHaveTextContent('Copied!');
      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(copy).toHaveTextContent('Copied!');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(copy).toHaveTextContent('Copy link');

      await clickAndSettle(copy);
      fireEvent.click(screen.getByRole('button', { name: 'Invite someone else' }));
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'next@example.com' },
      });
      await clickAndSettle(screen.getByRole('button', { name: 'Create invite link' }));
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    });

    it('asks for a manual copy when the clipboard refuses', async () => {
      const copy = await linkReady();
      stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
      await clickAndSettle(copy);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not copy to clipboard — please copy the link manually.',
      );
      expect(copy).toHaveTextContent('Copy link');
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('asks for a manual copy with no clipboard at all', async () => {
      const copy = await linkReady();
      stubClipboard(undefined);
      await clickAndSettle(copy);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Clipboard not available — please copy the link manually.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Invite someone else' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
