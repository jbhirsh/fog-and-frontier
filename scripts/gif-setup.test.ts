import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

const live = vi.hoisted(() => ({
  failed: new Map<string, string>(),
  liveSite: vi.fn(() => Promise.resolve()),
  cachePhotos: vi.fn(() => Promise.resolve({ failed: new Map<string, string>() })),
}));
vi.mock('./live-site.ts', async (actual) => ({
  ...(await actual<typeof import('./live-site.ts')>()),
  liveSite: live.liveSite,
  cachePhotos: live.cachePhotos,
}));

import setup, { production } from './gif-setup';
import { PHOTO_CACHE, PRODUCTION } from './live-site';

const page = {} as Page;
const ctx = (options: Record<string, string | boolean | undefined> = {}) => ({
  side: 'after' as const,
  origin: 'http://localhost:4173',
  options,
  root: '/app',
});

beforeEach(() => {
  live.failed = new Map();
  live.liveSite.mockClear();
  live.cachePhotos.mockReset();
  live.cachePhotos.mockImplementation(() => Promise.resolve({ failed: live.failed }));
});

describe('production', () => {
  it('is the live site unless --production names another, without its trailing slash', () => {
    expect(production({})).toBe(PRODUCTION);
    expect(production({ production: 'https://x.app/' })).toBe('https://x.app');
    expect(() => production({ production: 'x.app' })).toThrow(
      '--production must be an http(s) URL',
    );
  });
});

describe('the setup module', () => {
  it('adds --production and --allow-missing-photos', () => {
    expect(setup.options).toEqual({
      production: { type: 'string' },
      'allow-missing-photos': { type: 'boolean' },
    });
  });

  it("reads production's API and photos over the scenario's stub", async () => {
    await setup.afterSetup(page, ctx({ production: 'https://x.app' }));
    expect(live.liveSite).toHaveBeenCalledWith(page, 'https://x.app/api/graphql');
    expect(live.cachePhotos).toHaveBeenCalledWith(page, { production: 'https://x.app' });
  });

  it('refuses a recording with photos missing, unless allowed', async () => {
    await setup.afterSetup(page, ctx());
    await expect(setup.check(page, ctx())).resolves.toBeUndefined();
    live.failed.set('https://upload.wikimedia.org/a.jpg', 'HTTP 429');
    const refusal = setup.check(page, ctx());
    await expect(refusal).rejects.toThrow(
      "pr-gif: 1 photo didn't load for after: 1 from upload.wikimedia.org (HTTP 429).",
    );
    await expect(setup.check(page, ctx())).rejects.toThrow(PHOTO_CACHE);
    live.failed.set('https://upload.wikimedia.org/b.jpg', 'HTTP 429');
    await expect(setup.check(page, ctx())).rejects.toThrow('2 photos');
    await expect(setup.check(page, ctx({ 'allow-missing-photos': true }))).resolves.toBeUndefined();
  });

  it('checks nothing on a page it never set up', async () => {
    await expect(setup.check({} as Page, ctx())).resolves.toBeUndefined();
  });
});
