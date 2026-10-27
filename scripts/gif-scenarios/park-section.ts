// A park's hikes and stops on a phone: on main a boxed bar under its card,
// its words wrapping, opening a section whose title runs down a narrow
// column; on the branch the park drawn as a stack of cards, their count on
// its photo, opening a section titled by the park's name alone.
//
//   npm run gif -- scripts/gif-scenarios/park-section.ts --dir <PR number>
//
// Production's catalog, signed out, scrolled to Baker Beach before recording.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'park-section',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  async ready(page, gif) {
    await catalogReady(page, gif);
    // The list pages in as it scrolls (#102): down until the park's bar is
    // in, then it a third of the way down the screen.
    const bar = page.getByRole('button', { name: /hikes & stops in Baker Beach/ });
    for (let i = 0; i < 60 && (await bar.count()) === 0; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(250);
    }
    await bar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(1500);
  },
  async play(page, gif) {
    await page.waitForTimeout(1000);
    await gif.click(page, page.getByRole('button', { name: /hikes & stops in Baker Beach/ }), {
      ms: 800,
    });
    await page.waitForTimeout(1200);
    await gif.scroll(page, 320, 1000);
    await page.waitForTimeout(1600);
  },
};

export default scenario;
