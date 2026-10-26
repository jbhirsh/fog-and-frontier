// What the phone-sized catalog scenarios share: an iPhone's screen, and the
// catalog's first cards drawn in their fonts before recording starts.

import type { Page } from '@playwright/test';
import { glide } from '../pr-gif.ts';

export const PHONE = {
  path: '/',
  viewport: { width: 390, height: 844 },
  clip: { x: 0, y: 0, width: 390, height: 844 },
  width: 390,
};

/** Ready once the catalog's cards and fonts are in, the pointer mid-screen. */
export async function catalogReady(page: Page): Promise<void> {
  await page.locator('[data-activity-id]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await glide(page, { x: 200, y: 520 }, 0);
}
