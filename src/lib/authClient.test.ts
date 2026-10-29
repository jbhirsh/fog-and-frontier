import { afterEach, describe, expect, it, vi } from 'vitest';

// What the sign-in dialog offers, from the build's settings: One Tap's own
// Google client only on production (where alone the server takes it), and
// Apple once its Services ID is set.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('./authClient');
}

describe('authClient settings', () => {
  it('uses One Tap’s client on production', async () => {
    const { ONE_TAP_CLIENT_ID } = await load({
      VITE_VERCEL_ENV: 'production',
      VITE_GOOGLE_ONE_TAP_CLIENT_ID: 'one-tap',
    });
    expect(ONE_TAP_CLIENT_ID).toBe('one-tap');
  });

  it('uses none on a preview, even one given the client', async () => {
    const { ONE_TAP_CLIENT_ID } = await load({
      VITE_VERCEL_ENV: 'preview',
      VITE_GOOGLE_ONE_TAP_CLIENT_ID: 'one-tap',
    });
    expect(ONE_TAP_CLIENT_ID).toBe('');
  });

  it('uses none on production until it’s set', async () => {
    const { ONE_TAP_CLIENT_ID } = await load({ VITE_VERCEL_ENV: 'production' });
    expect(ONE_TAP_CLIENT_ID).toBe('');
  });

  it('offers Apple once its Services ID is set', async () => {
    expect((await load({ VITE_APPLE_CLIENT_ID: 'app.x' })).APPLE_SIGN_IN).toBe(true);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await load({ VITE_APPLE_CLIENT_ID: '' })).APPLE_SIGN_IN).toBe(false);
  });
});
