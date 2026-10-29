import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import { AccountMenu } from './AccountMenu';

type Listed = { id: string; name?: string; createdAt: string; backedUp: boolean };
const client = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  signOut: vi.fn(),
  useList: vi.fn(),
  list: {
    data: [] as Listed[] | null,
    isPending: false,
    error: null as { message: string } | null,
  },
}));
vi.mock('../lib/authClient', () => ({
  authClient: {
    passkey: { addPasskey: client.addPasskey, deletePasskey: client.deletePasskey },
    signOut: client.signOut,
    useListPasskeys: client.useList,
  },
}));
// Its own tests are SignInMethods.test.tsx.
vi.mock('./SignInMethods', () => ({ SignInMethods: () => <p>The sign-in methods</p> }));

const IPHONE: Listed = {
  id: 'p1',
  name: 'iPhone',
  createdAt: '2026-10-29T19:50:00.000Z',
  backedUp: true,
};
const KEY: Listed = { id: 'p2', createdAt: '2026-10-28T12:00:00.000Z', backedUp: false };
const dated = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

type PasskeyWindow = { PublicKeyCredential?: unknown };

const JESS: AuthState = { isLoaded: true, email: 'jess@example.com', name: 'Jess' };

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="at">{pathname + search}</span>;
}

function show(auth: AuthState = JESS, at = '/trips') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AuthCtx.Provider value={auth}>
        <header>
          <Routes>
            <Route path="*" element={<AccountMenu />} />
          </Routes>
        </header>
        <Where />
      </AuthCtx.Provider>
    </MemoryRouter>,
  );
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /Your account/ }));

beforeEach(() => {
  (window as PasskeyWindow).PublicKeyCredential = function PublicKeyCredential() {};
  client.addPasskey.mockResolvedValue({ data: {}, error: null });
  client.deletePasskey.mockResolvedValue({ data: { status: true }, error: null });
  client.list = { data: [IPHONE, KEY], isPending: false, error: null };
  client.useList.mockImplementation(() => client.list);
  client.signOut.mockResolvedValue({ data: { success: true }, error: null });
});

afterEach(() => {
  delete (window as PasskeyWindow).PublicKeyCredential;
  client.addPasskey.mockReset();
  client.deletePasskey.mockReset();
  client.useList.mockReset();
  client.signOut.mockReset();
});

describe('AccountMenu', () => {
  it('shows nothing while signed out', () => {
    const { container } = show({ isLoaded: true, email: null, name: null });
    expect(container.querySelector('button')).toBeNull();
  });

  it('is the account’s initial, named for screen readers', () => {
    show();
    expect(screen.getByRole('button', { name: 'Your account: Jess' })).toHaveTextContent('J');
  });

  it('falls back to the email with no name', () => {
    show({ isLoaded: true, email: 'sam@example.com', name: null });
    expect(screen.getByRole('button', { name: 'Your account: sam@example.com' })).toHaveTextContent(
      /^S$/,
    );
    open();
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();
    // The card's own initial, capitalised like the header's.
    expect(
      within(screen.getByRole('dialog', { name: 'Your account' })).getByText('S', { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/sam@example\.com/)).toHaveLength(1);
  });

  it('shows its sign-in methods', () => {
    show();
    open();
    expect(screen.getByRole('region', { name: 'Sign-in methods' })).toHaveTextContent(
      'The sign-in methods',
    );
  });

  describe('back from connecting Google or Apple', () => {
    it('opens, says it’s connected, and tidies the address', async () => {
      show(JESS, '/trips?view=map&account=linked&provider=apple');
      expect(screen.getByRole('dialog', { name: 'Your account' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Apple is connected.');
      await waitFor(() =>
        expect(screen.getByTestId('at')).toHaveTextContent(/^\/trips\?view=map$/),
      );
    });

    it('opens, and says why it wasn’t', async () => {
      show(
        JESS,
        '/trips?account=link-failed&provider=google&error=account_already_linked_to_different_user',
      );
      expect(screen.getByRole('alert')).toHaveTextContent('already has its own account here');
      await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent(/^\/trips$/));
    });

    it('stays closed on an ordinary visit', () => {
      show(JESS, '/trips?view=map');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByTestId('at')).toHaveTextContent(/^\/trips\?view=map$/);
    });
  });

  it('says who is signed in', () => {
    show();
    open();
    // Outside the header, whose blur would box a fixed overlay into it.
    expect(screen.getByRole('dialog', { name: 'Your account' }).closest('header')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Your account' });
    expect(within(dialog).getByText('Jess')).toBeInTheDocument();
    expect(within(dialog).getByText('jess@example.com')).toBeInTheDocument();
  });

  it('adds a passkey, and says so', async () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Passkey added');
    expect(client.addPasskey).toHaveBeenCalledWith({ name: expect.any(String) as string });
  });

  it('says so when no passkey was added', async () => {
    client.addPasskey.mockResolvedValue({ data: null, error: { message: 'failed' } });
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No passkey was added. Try again.');
  });

  it('holds its buttons while a passkey is being added, and clears an old note', async () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    await screen.findByRole('status');
    let done: (result: unknown) => void = () => {};
    client.addPasskey.mockReturnValue(new Promise((resolve) => (done = resolve)));
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    done({ data: {}, error: null });
    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('holds its buttons while signing out, and frees them after', async () => {
    let done: (result: unknown) => void = () => {};
    client.signOut.mockReturnValue(new Promise((resolve) => (done = resolve)));
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    done({ data: { success: true }, error: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    open();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('says a device that already has one has nothing to add', async () => {
    client.addPasskey.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'x' },
    });
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This device already has a passkey for your account',
    );
  });

  describe('its passkeys', () => {
    const list = () => screen.getByRole('list', { name: 'Your passkeys' });

    it('lists each by device, when it was added, and whether it syncs', () => {
      show();
      open();
      const [iphone, key] = within(list()).getAllByRole('listitem');
      expect(iphone).toHaveTextContent(`iPhone`);
      expect(iphone).toHaveTextContent(`Added ${dated(IPHONE.createdAt)} · Synced`);
      expect(key).toHaveTextContent('Passkey');
      expect(key).toHaveTextContent(`Added ${dated(KEY.createdAt)}`);
      expect(key).not.toHaveTextContent('Synced');
    });

    it('removes one only once asked again', async () => {
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      expect(client.deletePasskey).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await waitFor(() => expect(client.deletePasskey).toHaveBeenCalledWith({ id: 'p1' }));
    });

    it('reads the list only once the menu is open', () => {
      show();
      expect(client.useList).not.toHaveBeenCalled();
      open();
      expect(client.useList).toHaveBeenCalled();
    });

    it('moves focus to the confirmation, and back to Remove on Keep', () => {
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      expect(screen.getByRole('button', { name: 'Yes, remove iPhone' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Keep iPhone' }));
      expect(screen.getByRole('button', { name: /^Remove iPhone/ })).toHaveFocus();
    });

    it('can’t be asked twice while it’s being removed', async () => {
      let done: (result: unknown) => void = () => {};
      client.deletePasskey.mockReturnValue(new Promise((resolve) => (done = resolve)));
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      expect(screen.getByRole('button', { name: 'Yes, remove iPhone' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Keep iPhone' })).toBeDisabled();
      done({ data: { status: true }, error: null });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /iPhone/ })).not.toBeInTheDocument(),
      );
    });

    it('drops a removed one at once, before the list reloads', async () => {
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
      expect(list()).not.toHaveTextContent('iPhone');
    });

    it('moves focus to the next passkey once one is removed', async () => {
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Remove Passkey/ })).toHaveFocus(),
      );
    });

    it('moves focus to the dialog once the last is removed', async () => {
      client.list = { data: [IPHONE], isPending: false, error: null };
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await waitFor(() =>
        expect(screen.getByRole('dialog', { name: 'Your account' })).toHaveFocus(),
      );
      expect(screen.getByRole('region', { name: 'Passkeys' })).toHaveTextContent(
        'No passkeys yet.',
      );
    });

    it('moves focus to the one before once the last in the list is removed', async () => {
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove Passkey/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Passkey' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Remove iPhone/ })).toHaveFocus(),
      );
    });

    it('keeps another’s confirmation open while one is being removed', async () => {
      let done: (result: unknown) => void = () => {};
      client.deletePasskey.mockReturnValue(new Promise((resolve) => (done = resolve)));
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      fireEvent.click(screen.getByRole('button', { name: /^Remove Passkey/ }));
      done({ data: { status: true }, error: null });
      await waitFor(() => expect(list()).not.toHaveTextContent('iPhone'));
      expect(screen.getByRole('button', { name: 'Yes, remove Passkey' })).toBeInTheDocument();
    });

    it('gives focus back to Remove when a removal fails', async () => {
      client.deletePasskey.mockResolvedValue({ data: null, error: { message: 'nope' } });
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await screen.findByRole('alert');
      // Focus moves in an effect, just after the alert shows.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Remove iPhone/ })).toHaveFocus(),
      );
    });

    it('gives focus back to Remove when it had dropped to the page meanwhile', async () => {
      let done: (result: unknown) => void = () => {};
      client.deletePasskey.mockReturnValue(new Promise((resolve) => (done = resolve)));
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      // A browser drops focus from a button as it's disabled.
      (document.activeElement as HTMLElement).blur();
      done({ data: null, error: { message: 'nope' } });
      await screen.findByRole('alert');
      // Focus moves in an effect, just after the alert shows.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Remove iPhone/ })).toHaveFocus(),
      );
    });

    it('leaves focus where it went if a failed removal comes back late', async () => {
      let done: (result: unknown) => void = () => {};
      client.deletePasskey.mockReturnValue(new Promise((resolve) => (done = resolve)));
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      screen.getByRole('button', { name: 'Add a passkey' }).focus();
      done({ data: null, error: { message: 'nope' } });
      await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Add a passkey' })).toHaveFocus();
    });

    it('clears a failure once a retry works', async () => {
      client.deletePasskey.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('offers no Add where the browser has no passkeys', () => {
      delete (window as PasskeyWindow).PublicKeyCredential;
      client.list = { data: [], isPending: false, error: null };
      show();
      open();
      const region = screen.getByRole('region', { name: 'Passkeys' });
      expect(region).toHaveTextContent('No passkeys yet.');
      expect(region).not.toHaveTextContent('Add one');
    });

    it('keeps it when told to', () => {
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep iPhone' }));
      expect(screen.getByRole('button', { name: /^Remove iPhone/ })).toBeInTheDocument();
      expect(client.deletePasskey).not.toHaveBeenCalled();
    });

    it('says so when one can’t be removed', async () => {
      client.deletePasskey.mockResolvedValue({ data: null, error: { message: 'nope' } });
      show();
      open();
      fireEvent.click(screen.getByRole('button', { name: /^Remove iPhone/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove iPhone' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be removed');
    });

    it.each([
      ['while loading', { data: null, isPending: true, error: null }, 'Loading your passkeys…'],
      ['with none', { data: [], isPending: false, error: null }, 'No passkeys yet.'],
      ['with no list at all', { data: null, isPending: false, error: null }, 'No passkeys yet.'],
      [
        'when the list fails',
        { data: null, isPending: false, error: { message: 'x' } },
        'couldn’t be loaded',
      ],
    ])('says what there is %s', (_, state, text) => {
      client.list = state;
      show();
      open();
      expect(screen.getByRole('region', { name: 'Passkeys' })).toHaveTextContent(text);
    });
  });

  it('offers no passkey where the browser has none', () => {
    delete (window as PasskeyWindow).PublicKeyCredential;
    show();
    open();
    expect(screen.queryByRole('button', { name: 'Add a passkey' })).not.toBeInTheDocument();
  });

  it('signs out and goes home', async () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent(/^\/$/));
    expect(client.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes from its close button', () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears an old note when opened again', async () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    await screen.findByRole('status');
    fireEvent.keyDown(window, { key: 'Escape' });
    open();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
