// What the phone-sized catalog scenarios share: an iPhone's screen, and the
// catalog's first cards drawn in their fonts before recording starts.

import type { Page } from '@playwright/test';
import { mockApis } from '../../tests/visual/helpers';
import type { Gif } from '../gif-types.ts';
import { liveCatalog } from './live-catalog.ts';

export const PHONE = {
  path: '/',
  viewport: { width: 390, height: 844 },
  clip: { x: 0, y: 0, width: 390, height: 844 },
  width: 390,
};

/** Ready once the catalog's cards and fonts are in, the pointer mid-screen. */
export async function catalogReady(page: Page, gif: Gif): Promise<void> {
  await page.locator('[data-activity-id]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await gif.glide(page, { x: 200, y: 520 }, 0);
}

/** The phone's map, on production's catalog, signed out. */
export const PHONE_MAP = {
  ...PHONE,
  path: '/?view=map',
  async setup(page: Page): Promise<void> {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
};

/** Ready once the catalog is in and the map has drawn its pins. */
export async function mapReady(page: Page, gif: Gif): Promise<void> {
  await catalogReady(page, gif);
  await page.locator('.leaflet-marker-icon').nth(5).waitFor();
}
