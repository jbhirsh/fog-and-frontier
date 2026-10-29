// A place's page on a laptop: on main a phone's width in the middle of the
// screen; on the branch wider, its photo taller, and Nearby's places two to
// a row. Scrolled down to Nearby and back.
//
//   npm run gif -- scripts/gif-scenarios/wide-detail.ts --dir <PR number>
//
// Production's catalog, signed out.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { DESKTOP } from './desktop.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'wide-detail',
  ...DESKTOP,
  width: 960,
  path: '/activity/lgct-bike-ride',
  async setup(page) {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  async ready(page, gif) {
    await page.getByRole('dialog', { name: 'Los Gatos Creek Trail Bike Ride' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    await gif.glide(page, { x: 640, y: 520 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(1500);
    await gif.scroll(page, 700, 1600);
    await page.waitForTimeout(2200);
    await gif.scroll(page, 500, 1200);
    await page.waitForTimeout(2200);
    await gif.scroll(page, -1200, 1600);
    await page.waitForTimeout(1200);
  },
};

export default scenario;
