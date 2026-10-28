// A trip's page on a laptop, signed in: on main its own design (a tall
// header, the map, then the days in columns beside the unscheduled
// places); on the branch the phone's, in a column (a short header, Plan /
// Ideas / Map, a day at a time). Steps a day, then shows the ideas and map.
//
//   npm run gif -- scripts/gif-scenarios/desktop-trip.ts --dir <PR number>
//
// Trips need a real sign-in, so the trip is the stub's, on production's
// places and photos (live-trip.ts).

import type { Scenario } from '../gif-types.ts';
import { DESKTOP } from './desktop.ts';
import { LIVE_TRIP, tripReady } from './live-trip.ts';

const scenario: Scenario = {
  name: 'desktop-trip',
  ...DESKTOP,
  ...LIVE_TRIP,
  ready: (page, gif) => tripReady(page, gif, { x: 640, y: 420 }, 1500),
  async play(page, gif) {
    await page.waitForTimeout(1500);
    const days = page.getByRole('group', { name: 'Day' });
    if (!(await days.isVisible())) {
      // Main: the map, then the days in columns, down the page.
      await gif.scroll(page, 600, 1600);
      await page.waitForTimeout(2000);
      return;
    }
    await gif.click(page, days.getByRole('button').nth(1), { ms: 700 });
    await page.waitForTimeout(1200);
    const show = page.getByRole('group', { name: 'Show' });
    await gif.click(page, show.getByRole('button', { name: /^Ideas/ }), { ms: 700 });
    await page.waitForTimeout(1200);
    await gif.click(page, show.getByRole('button', { name: 'Map' }), { ms: 700 });
    await page.waitForTimeout(2000);
  },
};

export default scenario;
