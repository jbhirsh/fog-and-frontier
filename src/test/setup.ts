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
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});
