// A place's Nearby on a phone: on main the grouped tiles the owners liked;
// on the branch, after a sideways row they didn't, the same groups as rows,
// each place's photo, name, town, miles from here and time. Scrolled
// through.
//
//   npm run gif -- scripts/gif-scenarios/nearby-list.ts --dir <PR number>
//
// Production's catalog, signed out, opened at Nearby.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'nearby-list',
  ...PHONE,
  path: '/activity/lgct-bike-ride',
  async setup(page) {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  async ready(page, gif) {
    await page.getByRole('dialog', { name: 'Los Gatos Creek Trail Bike Ride' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Nearby at the top of the screen, before recording.
    await page
      .getByRole('heading', { name: /^Nearby/ })
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(2000);
    await gif.glide(page, { x: 200, y: 600 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(1800);
    await gif.scroll(page, 500, 1400);
    await page.waitForTimeout(1500);
    await gif.scroll(page, -500, 1200);
    await page.waitForTimeout(1200);
  },
};

export default scenario;
