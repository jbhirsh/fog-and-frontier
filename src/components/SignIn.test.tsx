import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInButton, SignInDialog } from './SignIn';

const client = vi.hoisted(() => ({ social: vi.fn(), passkey: vi.fn() }));
vi.mock('../lib/authClient', () => ({
  authClient: { signIn: { social: client.social, passkey: client.passkey } },
}));

type PasskeyWindow = { PublicKeyCredential?: unknown };
const withPasskeys = (on: boolean) => {
  if (on) (window as PasskeyWindow).PublicKeyCredential = function PublicKeyCredential() {};
  else delete (window as PasskeyWindow).PublicKeyCredential;
};

beforeEach(() => {
  client.social.mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null });
  client.passkey.mockResolvedValue({ data: { session: {} }, error: null });
  withPasskeys(true);
});

afterEach(() => {
  client.social.mockReset();
  client.passkey.mockReset();
  withPasskeys(false);
});

describe('SignInDialog', () => {
  it('signs in with Google, coming back to this page', () => {
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(client.social).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: window.location.href,
    });
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  });

  it('says so when Google sign-in doesn’t start, and lets it be tried again', async () => {
    client.social.mockResolvedValue({ data: null, error: { message: 'nope' } });
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in didn’t start');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('signs in with a passkey and closes', async () => {
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(client.passkey).toHaveBeenCalledOnce();
  });

  it('stays open and points to Google when the passkey fails', async () => {
    client.passkey.mockResolvedValue({ data: null, error: { message: 'cancelled' } });
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try Google');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no passkey where the browser has none', () => {
    withPasskeys(false);
    render(<SignInDialog onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /passkey/ })).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('SignInButton', () => {
  it('opens the dialog, styled as its caller says, and closes it again', () => {
    render(<SignInButton className="rounded-full">Sign in</SignInButton>);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toHaveClass('rounded-full');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens its dialog outside the header it sits in', () => {
    render(
      <header>
        <SignInButton className="rounded-full">Sign in</SignInButton>
      </header>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('dialog', { name: 'Sign in' }).closest('header')).toBeNull();
  });
});
