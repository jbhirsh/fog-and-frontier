import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SignInMethods } from './SignInMethods';

// The ways into the account, in its menu: which are connected, and
// Connect, which hands Better Auth's linkSocial this page to come back to.

type Answer = { data: { providerId: string }[]; error: null } | { data: null; error: object };
const client = vi.hoisted(() => ({
  listAccounts: vi.fn<() => Promise<Answer>>(),
  linkSocial: vi.fn(),
  flags: { apple: true },
}));
vi.mock('../lib/authClient', () => ({
  authClient: { listAccounts: client.listAccounts, linkSocial: client.linkSocial },
  get APPLE_SIGN_IN() {
    return client.flags.apple;
  },
}));

const accounts = (...providerIds: string[]): Answer => ({
  data: providerIds.map((providerId) => ({ providerId })),
  error: null,
});

beforeEach(() => {
  client.flags.apple = true;
  client.listAccounts.mockResolvedValue(accounts('google'));
  client.linkSocial.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  client.listAccounts.mockReset();
  client.linkSocial.mockReset();
});

const row = (name: string) =>
  within(screen.getByRole('list', { name: 'Your sign-in methods' }))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.startsWith(name));

describe('SignInMethods', () => {
  it('says which are connected, and offers to connect the rest', async () => {
    render(<SignInMethods />);
    await screen.findByRole('list', { name: 'Your sign-in methods' });
    expect(row('Google')).toHaveTextContent('Connected');
    expect(
      within(row('Apple') as HTMLElement).getByRole('button', { name: 'Connect Apple' }),
    ).toBeEnabled();
    expect(row('Google')?.querySelector('svg')).not.toBeNull();
    expect(row('Apple')?.querySelector('svg')).not.toBeNull();
  });

  it('offers no Apple until it’s set up', async () => {
    client.flags.apple = false;
    client.listAccounts.mockResolvedValue(accounts());
    render(<SignInMethods />);
    await screen.findByRole('button', { name: 'Connect Google' });
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  it('connects one through its provider, coming back here saying how it went', async () => {
    render(<SignInMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Apple' }));
    const here = new URL(window.location.href);
    const back = (outcome: string) => {
      const url = new URL(here);
      url.searchParams.set('account', outcome);
      url.searchParams.set('provider', 'apple');
      return url.toString();
    };
    expect(client.linkSocial).toHaveBeenCalledWith({
      provider: 'apple',
      callbackURL: back('linked'),
      errorCallbackURL: back('link-failed'),
    });
    expect(screen.getByRole('button', { name: 'Connect Apple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect Apple' })).toHaveTextContent('Opening…');
  });

  it('says so when connecting doesn’t start, and lets it be tried again', async () => {
    client.listAccounts.mockResolvedValue(accounts());
    client.linkSocial.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    render(<SignInMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connecting Google didn’t start');
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect Google' })).toHaveTextContent(/^Connect$/);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays held, saying nothing, once connecting has started', async () => {
    client.linkSocial.mockResolvedValue({
      data: { url: 'https://appleid.apple.com/x' },
      error: null,
    });
    render(<SignInMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Apple' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Connect Apple' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stands down when the browser brings the page back without connecting', async () => {
    render(<SignInMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Apple' }));
    expect(screen.getByRole('button', { name: 'Connect Apple' })).toHaveTextContent('Opening…');
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });
    expect(screen.getByRole('button', { name: 'Connect Apple' })).toHaveTextContent(/^Connect$/);
    expect(screen.getByRole('button', { name: 'Connect Apple' })).toBeEnabled();
  });

  it('says connecting didn’t start when the request itself fails', async () => {
    client.listAccounts.mockResolvedValue(accounts());
    client.linkSocial.mockRejectedValue(new Error('offline'));
    render(<SignInMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connecting Google didn’t start');
  });

  it('says it’s loading, then what it read', async () => {
    let answer: (value: Answer) => void = () => {};
    client.listAccounts.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<SignInMethods />);
    expect(screen.getByText('Loading your sign-in methods…')).toBeInTheDocument();
    await act(async () => {
      answer(accounts('apple'));
      await Promise.resolve();
    });
    expect(row('Apple')).toHaveTextContent('Connected');
  });

  it('says so when they can’t be read', async () => {
    client.listAccounts.mockResolvedValue({ data: null, error: { message: 'nope' } });
    render(<SignInMethods />);
    await waitFor(() =>
      expect(screen.getByText('Your sign-in methods couldn’t be loaded.')).toBeInTheDocument(),
    );
  });
});
