// A place's page on a phone: on main a tall photo, a big title and one fact
// a line; on the branch (#293) a shorter photo with Back and Share, the name
// with the dog beside it, the facts on one line, Directions, and Nearby
// sideways. Scrolled down and back.
//
//   npm run gif -- scripts/gif-scenarios/place-page.ts --dir <PR number>
//
// Production's catalog, signed out. Until the dog rules backfill (#296),
// production has no rules pages, so the dog shows as the symbol alone.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'place-page',
  ...PHONE,
  // Dog friendly, rated, free, in a park, with places near it.
  path: '/activity/blue-heron-strawberry-hill',
  async setup(page) {
    await mockApis(page);
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  async ready(page, gif) {
    await page.getByRole('dialog', { name: 'Blue Heron Lake and Strawberry Hill Loop' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    await gif.glide(page, { x: 200, y: 600 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(1500);
    await gif.scroll(page, 600, 1400);
    await page.waitForTimeout(1500);
    await gif.scroll(page, -600, 1200);
    await page.waitForTimeout(1000);
  },
};

export default scenario;
