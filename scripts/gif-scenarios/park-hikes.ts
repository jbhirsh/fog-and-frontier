// A park's hikes and stops (#269): held under its card, opened below its row.
//
//   npm run gif -- scripts/gif-scenarios/park-hikes.ts --dir <PR number>
//
// Production's catalog, searched to Point Reyes, with three of its hikes
// given their park: no saved activity has one until the feature ships. On
// main they're cards of their own, with nothing to open.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { liveCatalog } from './live-catalog.ts';

const PARK = 'point-reyes-seashore';
const HIKES = new Set(['chimney-rock-trail', 'tomales-point-trail', 'coast-trail-point-reyes']);

const scenario: Scenario = {
  name: 'park-hikes',
  path: '/?view=list&q=point%20reyes',
  viewport: { width: 1280, height: 800 },
  // Below the app header.
  clip: { x: 0, y: 80, width: 1280, height: 720 },
  width: 800,
  async setup(page) {
    await mockApis(page);
    await liveCatalog(page, { parentId: (a) => (HIKES.has(a.id) ? PARK : null) });
  },
  async ready(page, gif) {
    await page.locator('[data-activity-id]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await gif.glide(page, { x: 640, y: 500 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(600);
    const bar = page.getByRole('button', { name: /hikes & stops in Point Reyes/ });
    if ((await bar.count()) === 0) {
      // Main: the hikes are cards of their own.
      await gif.scroll(page, 400);
      await page.waitForTimeout(1200);
      await gif.scroll(page, -400);
      await page.waitForTimeout(1500);
      return;
    }
    await gif.click(page, bar, { ms: 700 });
    await page.waitForTimeout(900);
    await gif.scroll(page, 350);
    await page.waitForTimeout(1200);
    await gif.click(page, page.getByRole('button', { name: /^Close .*hikes and stops$/ }), {
      ms: 700,
    });
    await page.waitForTimeout(1500);
  },
};

export default scenario;
