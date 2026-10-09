import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { AuthCtx, useAuthState, type AuthState } from './authShim';

type ForceEmailWindow = { __TEST_FORCE_EMAIL__?: unknown };

const SIGNED_OUT: AuthState = {
  isLoaded: false,
  email: null,
  getToken: () => Promise.resolve(null),
};

function authState() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(AuthCtx.Provider, { value: SIGNED_OUT }, children);
  return renderHook(() => useAuthState(), { wrapper }).result.current;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as ForceEmailWindow).__TEST_FORCE_EMAIL__;
});

describe('useAuthState', () => {
  it('reads the provided auth state', () => {
    expect(authState()).toBe(SIGNED_OUT);
  });

  it('defaults to a loaded, signed-out visitor without a provider', async () => {
    const state = renderHook(() => useAuthState()).result.current;
    expect(state).toMatchObject({ isLoaded: true, email: null });
    await expect(state.getToken()).resolves.toBeNull();
  });

  describe('window.__TEST_FORCE_EMAIL__ (Playwright escape hatch)', () => {
    it('signs in as the forced email in a test build', () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', 'test');
      (window as ForceEmailWindow).__TEST_FORCE_EMAIL__ = 'jess@example.com';
      expect(authState()).toMatchObject({ isLoaded: true, email: 'jess@example.com' });
    });

    it('signs in as the forced email in dev', () => {
      vi.stubEnv('DEV', true);
      vi.stubEnv('MODE', 'development');
      (window as ForceEmailWindow).__TEST_FORCE_EMAIL__ = 'jess@example.com';
      expect(authState().email).toBe('jess@example.com');
    });

    it('is ignored in a production build', () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', 'production');
      (window as ForceEmailWindow).__TEST_FORCE_EMAIL__ = 'jess@example.com';
      expect(authState()).toBe(SIGNED_OUT);
    });

    it.each([[''], [true], [42]])('ignores a non-email value (%s)', (value) => {
      vi.stubEnv('MODE', 'test');
      (window as ForceEmailWindow).__TEST_FORCE_EMAIL__ = value;
      expect(authState()).toBe(SIGNED_OUT);
    });
  });
});
