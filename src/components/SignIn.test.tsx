import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInButton, SignInDialog } from './SignIn';

const client = vi.hoisted(() => ({
  social: vi.fn(),
  passkey: vi.fn(),
  flags: { apple: true },
}));
vi.mock('../lib/authClient', () => ({
  authClient: { signIn: { social: client.social, passkey: client.passkey } },
  get APPLE_SIGN_IN() {
    return client.flags.apple;
  },
}));
const google = vi.hoisted(() => ({ release: vi.fn(), hold: vi.fn() }));
vi.mock('../lib/oneTap', () => ({ holdOneTapPrompt: google.hold }));
const dom = vi.hoisted(() => ({ preconnect: vi.fn<(href: string) => void>() }));
vi.mock('react-dom', async (actual) => ({
  ...(await actual<typeof import('react-dom')>()),
  preconnect: dom.preconnect,
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
  google.hold.mockReturnValue(google.release);
  withPasskeys(true);
});

afterEach(() => {
  client.social.mockReset();
  client.passkey.mockReset();
  dom.preconnect.mockReset();
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
  ])('signs in with %s, coming back to this page, and says it’s on its way', (label, provider) => {
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: `Continue with ${label}` }));
    expect(client.social).toHaveBeenCalledWith({ provider, callbackURL: window.location.href });
    expect(screen.getByRole('button', { name: `Opening ${label}…` })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^Opening/ })).toHaveLength(1);
    // Every other way in waits too.
    for (const button of screen.getAllByRole('button', { name: /^(Continue|Sign in) with/ })) {
      expect(button).toBeDisabled();
    }
  });

  it('stands down when the browser brings the page back from Google’s or Apple’s', () => {
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(screen.getByRole('button', { name: 'Opening Apple…' })).toBeDisabled();
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
  });

  it('says a sign-in didn’t start when the request itself fails', async () => {
    client.social.mockRejectedValue(new Error('offline'));
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in didn’t start');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('connects to Apple’s and Google’s sign-in hosts as it opens', () => {
    render(<SignInDialog onClose={() => {}} />);
    expect(dom.preconnect.mock.calls.map(([host]) => host)).toEqual([
      'https://appleid.apple.com',
      'https://accounts.google.com',
    ]);
  });

  it('connects only to Google’s until Apple is set up', () => {
    client.flags.apple = false;
    render(<SignInDialog onClose={() => {}} />);
    expect(dom.preconnect.mock.calls.map(([host]) => host)).toEqual([
      'https://accounts.google.com',
    ]);
  });

  it('says so when a sign-in doesn’t start, and lets it be tried again', async () => {
    client.social.mockResolvedValue({ data: null, error: { message: 'nope' } });
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Apple sign-in didn’t start');
    // Back to Continue, ready to try again.
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
  });

  it('draws each provider’s logo', () => {
    render(<SignInDialog onClose={() => {}} />);
    for (const name of ['Continue with Apple', 'Continue with Google']) {
      expect(screen.getByRole('button', { name }).querySelector('svg')).not.toBeNull();
    }
  });

  it('stays waiting once a sign-in has started, leaving the page to Google', async () => {
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Opening Google…' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears an old error as a sign-in is tried again', async () => {
    client.social.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    await screen.findByRole('alert');
    client.social.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opening Apple…' })).toBeDisabled();
  });

  it('holds every button while a passkey is asked for, and frees them if it fails', async () => {
    let done: (result: unknown) => void = () => {};
    client.passkey.mockReturnValue(new Promise((resolve) => (done = resolve)));
    // An old error first (Apple's), which asking for a passkey clears.
    client.social.mockResolvedValue({ data: null, error: { message: 'nope' } });
    render(<SignInDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in with a passkey/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    await act(async () => {
      done({ data: null, error: { message: 'cancelled' } });
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /Sign in with a passkey/ })).toBeEnabled();
  });

  it('offers no Apple until it’s set up', () => {
    client.flags.apple = false;
    render(<SignInDialog onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Apple/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('holds One Tap’s prompt while it’s open, and lets go as it closes', () => {
    const { unmount } = render(<SignInDialog onClose={() => {}} />);
    expect(google.hold).toHaveBeenCalledOnce();
    expect(google.release).not.toHaveBeenCalled();
    unmount();
    expect(google.release).toHaveBeenCalledOnce();
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
