import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createElement, Fragment, type ReactNode } from 'react';

// Default Clerk mock: signed-out viewer. Tests that need an owner-signed-in
// state override the useUser / useAuth return value per test.
vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: false,
    getToken: () => Promise.resolve(null),
  }),
  ClerkProvider: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SignedIn: () => null,
  SignedOut: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SignInButton: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  UserButton: () => null,
  AuthenticateWithRedirectCallback: () => null,
}));

// useUserActivities pulls /api/activities once on mount. In tests we don't
// hit the network — stub fetch to reject so the catch path keeps whatever the
// test seeded into localStorage. Individual tests can override via vi.stubGlobal.
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

afterEach(() => {
  cleanup();
  localStorage.clear();
});
