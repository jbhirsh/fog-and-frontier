import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInButton, SignInDialog } from './SignIn';

const client = vi.hoisted(() => ({
  social: vi.fn(),
  passkey: vi.fn(),
  flags: { apple: true, oneTap: '' },
}));
vi.mock('../lib/authClient', () => ({
  authClient: { signIn: { social: client.social, passkey: client.passkey } },
  get APPLE_SIGN_IN() {
    return client.flags.apple;
  },
  get ONE_TAP_CLIENT_ID() {
    return client.flags.oneTap;
  },
}));
const google = vi.hoisted(() => ({
  render: vi.fn<(c: HTMLElement, w: number, done: () => void) => Promise<boolean>>(),
  release: vi.fn(),
  hold: vi.fn(),
}));
vi.mock('../lib/oneTap', () => ({
  renderGoogleButton: google.render,
  holdOneTapPrompt: google.hold,
}));

type PasskeyWindow = { PublicKeyCredential?: unknown };
const withPasskeys = (on: boolean) => {
  if (on) (window as PasskeyWindow).PublicKeyCredential = function PublicKeyCredential() {};
  else delete (window as PasskeyWindow).PublicKeyCredential;
};

beforeEach(() => {
  client.social.mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null });
  client.passkey.mockResolvedValue({ data: { session: {} }, error: null });
  client.flags.apple = true;
  client.flags.oneTap = '';
  google.render.mockResolvedValue(false);
  google.hold.mockReturnValue(google.release);
  withPasskeys(true);
});

afterEach(() => {
  client.social.mockReset();
  client.passkey.mockReset();
  google.render.mockReset();
  google.hold.mockReset();
  google.release.mockReset();
  withPasskeys(false);
});

describe('SignInDialog', () => {
  it('is a card that says where you’re signing in', () => {
    render(<SignInDialog onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Sign in to Fog and Frontier' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('New here? Your first sign-in makes your account.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['Apple', 'apple'],
    ['Google', 'google'],
  ])('signs in with %s, coming back to this page', (label, provider) => {
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: `Continue with ${label}` }));
    expect(client.social).toHaveBeenCalledWith({ provider, callbackURL: window.location.href });
    expect(screen.getByRole('button', { name: `Continue with ${label}` })).toBeDisabled();
  });

  it('says so when a sign-in doesn’t start, and lets it be tried again', async () => {
    client.social.mockResolvedValue({ data: null, error: { message: 'nope' } });
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Apple sign-in didn’t start');
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
  });

  it('offers no Apple until it’s set up', () => {
    client.flags.apple = false;
    render(<SignInDialog onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Apple/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('asks for Google’s own button only where One Tap’s client is', () => {
    render(<SignInDialog onClose={() => {}} />);
    expect(google.render).not.toHaveBeenCalled();
  });

  it('shows Google’s own button once it’s drawn, in place of its own', async () => {
    client.flags.oneTap = 'one-tap-client';
    google.render.mockResolvedValue(true);
    render(<SignInDialog onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Continue with Google' }),
      ).not.toBeInTheDocument(),
    );
    expect(google.render).toHaveBeenCalledOnce();
  });

  it('keeps its own Google button where Google’s can’t be drawn', async () => {
    client.flags.oneTap = 'one-tap-client';
    const drawn = Promise.resolve(false);
    google.render.mockReturnValue(drawn);
    render(<SignInDialog onClose={() => {}} />);
    await waitFor(() => expect(google.render).toHaveBeenCalledOnce());
    // Past the answer, and the state it sets.
    await act(() => drawn);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('holds One Tap’s prompt while it’s open, and lets go as it closes', () => {
    const { unmount } = render(<SignInDialog onClose={() => {}} />);
    expect(google.hold).toHaveBeenCalledOnce();
    expect(google.release).not.toHaveBeenCalled();
    unmount();
    expect(google.release).toHaveBeenCalledOnce();
  });

  it('closes once Google’s own button has signed someone in', async () => {
    client.flags.oneTap = 'one-tap-client';
    google.render.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    await waitFor(() => expect(google.render).toHaveBeenCalledOnce());
    google.render.mock.calls[0][2]();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('signs in with a passkey and closes', async () => {
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(client.passkey).toHaveBeenCalledOnce();
  });

  it('stays open and points elsewhere when the passkey fails', async () => {
    client.passkey.mockResolvedValue({ data: null, error: { message: 'cancelled' } });
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try Google or Apple');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no passkey where the browser has none', () => {
    withPasskeys(false);
    render(<SignInDialog onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /passkey/ })).not.toBeInTheDocument();
  });

  it('closes on Escape and from its close button', () => {
    const onClose = vi.fn();
    render(<SignInDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
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
