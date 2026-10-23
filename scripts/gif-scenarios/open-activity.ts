// Opening an activity from the catalog, then a few keys: an example scenario
// for scripts/pr-gif-cli.ts, and a starting point for a PR's own.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/open-activity.ts --dir <PR number>
//
// Recorded on local builds of main and the branch, reading production's
// catalog and photos. setup stubs the API for anything production can't
// answer; a screen only an owner sees would also sign in here (signIn in
// tests/visual/helpers.ts).

import { mockApis } from '../../tests/visual/helpers';
import { click, glide, scroll, type Scenario } from '../pr-gif.ts';

const scenario: Scenario = {
  name: 'open-activity',
  path: '/?view=list',
  viewport: { width: 1100, height: 640 },
  // Below the app header.
  clip: { x: 0, y: 80, width: 1100, height: 560 },
  width: 600,
  async setup(page) {
    await mockApis(page);
  },
  async ready(page) {
    await page.locator('[data-activity-id]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Start where the first move will be seen.
    await glide(page, { x: 550, y: 420 }, 0);
  },
  async run(page) {
    await page.waitForTimeout(400);
    await click(page, page.locator('[data-activity-id]').first(), { ms: 700 });
    await page.waitForTimeout(900);
    await scroll(page, 300);
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  },
};

export default scenario;
