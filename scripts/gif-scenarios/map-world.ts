// The mobile map panned round the world: on main the next copy of the
// world shows with no pins on it; on the branch the view jumps back onto
// the copy the pins are drawn on, so they stay in sight.
//
//   npm run gif -- scripts/gif-scenarios/map-world.ts --dir <PR number>
//
// Production's catalog, signed out, zoomed all the way out first.

import type { Scenario } from '../gif-types.ts';
import { PHONE_MAP, mapReady } from './phone.ts';

const scenario: Scenario = {
  name: 'map-world',
  ...PHONE_MAP,
  async ready(page, gif) {
    await mapReady(page, gif);
    // As far out as the map goes, before recording.
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    for (let i = 0; i < 12 && !(await zoomOut.isDisabled()); i++) {
      await zoomOut.click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1500);
  },
  async play(page, gif) {
    await page.waitForTimeout(1200);
    // West, a little more than a whole world, a drag at a time.
    for (let i = 0; i < 4; i++) {
      await gif.drag(page, { x: 60, y: 380 }, { x: 340, y: 380 }, 700);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
    // A tap on the copy it came back to, the pins still there.
    await gif.click(page, { x: 200, y: 380 }, { ms: 400 });
    await page.waitForTimeout(1500);
  },
};

export default scenario;
