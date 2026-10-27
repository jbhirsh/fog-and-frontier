// A trip's page on a phone, signed in, on the visual tests' trip: on main
// its header, members and map, then each day a column of large cards; on
// the branch (#294) a short header, Plan / Ideas / Map, the days as
// buttons, a day's places as rows, a handle's moves, and the ideas and map.
//
//   npm run gif -- scripts/gif-scenarios/trip-phone.ts --dir <PR number>
//
// Trips need a real sign-in, so the trip is the stub's.

import { mockApis, signIn } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE } from './phone.ts';

const scenario: Scenario = {
  name: 'trip-phone',
  ...PHONE,
  path: '/trips/fixture-trip-planning',
  async setup(page) {
    await mockApis(page);
    await signIn(page);
  },
  async ready(page, gif) {
    await page.getByRole('heading', { name: 'Coast Weekend' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await gif.glide(page, { x: 200, y: 600 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(1200);
    const days = page.getByRole('group', { name: 'Day' });
    if (!(await days.isVisible())) {
      // Main: the days run down the page.
      await gif.scroll(page, 700, 1600);
      await page.waitForTimeout(1200);
      await gif.scroll(page, 700, 1600);
      await page.waitForTimeout(1500);
      return;
    }
    await gif.click(page, days.getByRole('button').nth(1), { ms: 700 });
    await page.waitForTimeout(900);
    await gif.click(page, days.getByRole('button').nth(0), { ms: 600 });
    await page.waitForTimeout(700);
    await gif.click(page, page.getByRole('button', { name: /^Move or change/ }).first(), {
      ms: 700,
    });
    await page.waitForTimeout(1400);
    // Its backdrop, above the dialog, puts it away.
    await gif.click(page, { x: 200, y: 110 }, { ms: 600 });
    await page.waitForTimeout(600);
    const show = page.getByRole('group', { name: 'Show' });
    await gif.click(page, show.getByRole('button', { name: /^Ideas/ }), { ms: 700 });
    await page.waitForTimeout(1200);
    await gif.click(page, show.getByRole('button', { name: 'Map' }), { ms: 600 });
    await page.waitForTimeout(1500);
  },
};

export default scenario;
