// Swiping from one place to the next on a phone: on main the neighbour
// slides in as its photo and name alone and its page fills in once it has
// landed; on the branch its whole page slides in, so nothing changes when it
// lands.
//
//   npm run gif -- scripts/gif-scenarios/swipe-step.ts --dir <PR number>
//
// Production's catalog, signed out. The detail steps on touch, so the swipes
// are gif.swipe's, a finger's, not drag's mouse.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'swipe-step',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(600);
    await gif.click(page, page.locator('[data-activity-id] button').first(), { ms: 600 });
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(1500);
    for (let i = 0; i < 2; i++) {
      await gif.swipe(page, { x: 330, y: 560 }, { x: 70, y: 560 }, 320);
      await page.waitForTimeout(1600);
    }
  },
};

export default scenario;
