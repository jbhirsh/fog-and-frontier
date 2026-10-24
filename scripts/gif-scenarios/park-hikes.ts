// A park's hikes and stops (#269): held under its card, opened below its row.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/park-hikes.ts --dir <PR number>
//
// Production's catalog, searched to Point Reyes, with three of its hikes
// given their park: no saved activity has one until the feature ships. On
// main they're cards of their own, with nothing to open.

import { mockApis } from '../../tests/visual/helpers';
import { click, glide, scroll, type Scenario } from '../pr-gif.ts';
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
  async ready(page) {
    await page.locator('[data-activity-id]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await glide(page, { x: 640, y: 500 }, 0);
  },
  async run(page) {
    await page.waitForTimeout(600);
    const bar = page.getByRole('button', { name: /hikes & stops in Point Reyes/ });
    if ((await bar.count()) === 0) {
      // Main: the hikes are cards of their own.
      await scroll(page, 400);
      await page.waitForTimeout(1200);
      await scroll(page, -400);
      await page.waitForTimeout(1500);
      return;
    }
    await click(page, bar, { ms: 700 });
    await page.waitForTimeout(900);
    await scroll(page, 350);
    await page.waitForTimeout(1200);
    await click(page, page.getByRole('button', { name: /^Close .*hikes and stops$/ }), {
      ms: 700,
    });
    await page.waitForTimeout(1500);
  },
};

export default scenario;
