// The mobile map's list sheet after a place is opened from a pin: on main
// its card was scrolled into view by scrolling the sheet itself, so once
// the place closed the sheet's grab bar and header had gone up out of
// sight, the tops of the cards in their place; on the branch the sheet
// stays as it was.
//
//   npm run gif -- scripts/gif-scenarios/map-sheet.ts --dir <PR number>
//
// Production's catalog, signed out.

import type { Page } from '@playwright/test';
import type { Scenario } from '../gif-types.ts';
import { PHONE_MAP, mapReady } from './phone.ts';

// A single pin (not a group) in the clear part of the map.
async function pin(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('.leaflet-marker-icon:not(.pin-group)')) {
      if (el.textContent?.includes('home')) continue;
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (y > 160 && y < 560 && x > 40 && x < 320) return { x, y };
    }
    return null;
  });
}

const scenario: Scenario = {
  name: 'map-sheet',
  ...PHONE_MAP,
  async ready(page, gif) {
    await mapReady(page, gif);
    await page.waitForTimeout(1500);
  },
  async play(page, gif) {
    await page.waitForTimeout(1200);
    const at = await pin(page);
    if (!at) throw new Error('No single pin in view');
    await gif.click(page, at, { ms: 800 });
    await page.waitForTimeout(1200);
    // The branch cards the pin first; main opens the place straight away.
    const details = page.getByRole('button', { name: 'See details' });
    if (await details.count()) {
      await gif.click(page, details, { ms: 700 });
      await page.waitForTimeout(1500);
    }
    // Closed as a keyboard does: a phone's place has Back where main has ×.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
  },
};

export default scenario;
