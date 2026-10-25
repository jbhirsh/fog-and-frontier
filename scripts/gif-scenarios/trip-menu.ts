// A trip's "•••" menu on a phone (#287): on main the badge, Edit and •••
// wrap to the left under the title and the menu opens off the screen's left
// edge; on the branch they keep to the right and it opens within it.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/trip-menu.ts --dir <PR number>
//
// The trip is the visual tests' voting fixture: production's trips need a
// signed-in member, which a local build can't be.

import { mockApis, signIn } from '../../tests/visual/helpers';
import { click, glide, type Scenario } from '../pr-gif.ts';

const scenario: Scenario = {
  name: 'trip-menu',
  path: '/trips/fixture-trip-voting',
  viewport: { width: 390, height: 844 },
  clip: { x: 0, y: 0, width: 390, height: 844 },
  width: 390,
  async setup(page) {
    await mockApis(page);
    await signIn(page);
  },
  async ready(page) {
    await page.getByRole('heading', { name: 'Spring Getaway' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await glide(page, { x: 200, y: 520 }, 0);
  },
  async run(page) {
    await page.waitForTimeout(600);
    // Named by its icon on main, by its label on the branch.
    await click(page, page.getByRole('button', { name: /more_horiz|More trip actions/ }), {
      ms: 700,
    });
    await page.waitForTimeout(2500);
  },
};

export default scenario;
