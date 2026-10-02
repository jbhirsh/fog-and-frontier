import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { AuthState } from './authShim';

type ForceFlagWindow = { __TEST_FORCE_OWNER__?: boolean };

// The owner list is read from VITE_OWNER_EMAILS when the module loads, so each
// test stubs the env first and then imports a fresh copy of the module graph
// (useOwner and the AuthCtx it reads must come from the same load).
async function renderOwner(
  email: string | null,
  ownerEmails = 'owner@example.com',
) {
  vi.stubEnv('VITE_OWNER_EMAILS', ownerEmails);
  vi.resetModules();
  const { AuthCtx } = await import('./authShim');
  const { useOwner } = await import('./useOwner');
  const auth: AuthState = {
    isLoaded: true,
    email,
    getToken: () => Promise.resolve(null),
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(AuthCtx.Provider, { value: auth }, children);
  return renderHook(() => useOwner(), { wrapper }).result.current;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as ForceFlagWindow).__TEST_FORCE_OWNER__;
});

describe('useOwner', () => {
  it('treats a signed-in email on the owner list as the owner', async () => {
    const owner = await renderOwner('owner@example.com');
    expect(owner).toEqual({
      isLoaded: true,
      email: 'owner@example.com',
      isOwner: true,
    });
  });

  it('does not treat another signed-in email as the owner', async () => {
    const owner = await renderOwner('friend@example.com');
    expect(owner.isOwner).toBe(false);
    expect(owner.email).toBe('friend@example.com');
  });

  it('treats a signed-out visitor as not the owner', async () => {
    const owner = await renderOwner(null);
    expect(owner).toEqual({ isLoaded: true, email: null, isOwner: false });
  });

  it('normalizes the signed-in email (trim + lowercase) before matching', async () => {
    const owner = await renderOwner('  Owner@Example.COM ');
    expect(owner.email).toBe('owner@example.com');
    expect(owner.isOwner).toBe(true);
  });

  it('normalizes each configured owner email and accepts any on the list', async () => {
    const list = ' First@Example.com , SECOND@example.com';
    expect((await renderOwner('first@example.com', list)).isOwner).toBe(true);
    expect((await renderOwner('second@example.com', list)).isOwner).toBe(true);
    expect((await renderOwner('third@example.com', list)).isOwner).toBe(false);
  });

  it('has no owner when VITE_OWNER_EMAILS is empty', async () => {
    expect((await renderOwner('owner@example.com', '')).isOwner).toBe(false);
  });

  it('never matches a blank email, even with a blank entry in the list', async () => {
    const owner = await renderOwner('   ', 'owner@example.com,');
    expect(owner.email).toBe('');
    expect(owner.isOwner).toBe(false);
  });

  describe('window.__TEST_FORCE_OWNER__ (Playwright escape hatch)', () => {
    it('forces owner in dev without a session', async () => {
      vi.stubEnv('DEV', true);
      vi.stubEnv('MODE', 'development');
      (window as ForceFlagWindow).__TEST_FORCE_OWNER__ = true;
      expect((await renderOwner(null)).isOwner).toBe(true);
    });

    it('forces owner in test mode even when DEV is off', async () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', 'test');
      (window as ForceFlagWindow).__TEST_FORCE_OWNER__ = true;
      expect((await renderOwner(null)).isOwner).toBe(true);
    });

    it('is ignored in production', async () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', 'production');
      (window as ForceFlagWindow).__TEST_FORCE_OWNER__ = true;
      expect((await renderOwner(null)).isOwner).toBe(false);
    });

    it('only counts when set to exactly true', async () => {
      vi.stubEnv('DEV', true);
      (window as ForceFlagWindow).__TEST_FORCE_OWNER__ = false;
      expect((await renderOwner(null)).isOwner).toBe(false);
    });

    it('does nothing when unset', async () => {
      vi.stubEnv('DEV', true);
      expect((await renderOwner('friend@example.com')).isOwner).toBe(false);
    });
  });
});
