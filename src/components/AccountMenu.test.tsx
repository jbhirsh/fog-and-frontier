import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthCtx, type AuthState } from '../lib/authShim';
import { AccountMenu } from './AccountMenu';

const client = vi.hoisted(() => ({ addPasskey: vi.fn(), signOut: vi.fn() }));
vi.mock('../lib/authClient', () => ({
  authClient: { passkey: { addPasskey: client.addPasskey }, signOut: client.signOut },
}));

type PasskeyWindow = { PublicKeyCredential?: unknown };

const JESS: AuthState = { isLoaded: true, email: 'jess@example.com', name: 'Jess' };

function Where() {
  return <span data-testid="at">{useLocation().pathname}</span>;
}

function show(auth: AuthState = JESS) {
  return render(
    <MemoryRouter initialEntries={['/trips']}>
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
  client.signOut.mockResolvedValue({ data: { success: true }, error: null });
});

afterEach(() => {
  delete (window as PasskeyWindow).PublicKeyCredential;
  client.addPasskey.mockReset();
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
      'S',
    );
    open();
    expect(screen.getByText('Signed in as sam@example.com')).toBeInTheDocument();
  });

  it('says who is signed in', () => {
    show();
    open();
    // Outside the header, whose blur would box a fixed overlay into it.
    expect(screen.getByRole('dialog', { name: 'Your account' }).closest('header')).toBeNull();
    expect(screen.getByText('Signed in as Jess (jess@example.com)')).toBeInTheDocument();
  });

  it('adds a passkey, and says so', async () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Passkey added');
    expect(client.addPasskey).toHaveBeenCalledOnce();
  });

  it('says so when no passkey was added', async () => {
    client.addPasskey.mockResolvedValue({ data: null, error: { message: 'cancelled' } });
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No passkey was added.');
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
