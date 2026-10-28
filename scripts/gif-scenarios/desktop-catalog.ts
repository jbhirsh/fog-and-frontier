// The catalog on a laptop: on main its own design (cards with a category
// tag, a cut-off name and a facts row, a row of filter pills, and a place
// opening as a wide dialog); on the branch the phone's, widened (cards with
// their facts on the photo, the Filters button and sheet, and the place's
// page in a narrow dialog). Opens the filters, picks hikes, then a place.
//
//   npm run gif -- scripts/gif-scenarios/desktop-catalog.ts --dir <PR number>
//
// Production's catalog, signed out, in List.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { DESKTOP } from './desktop.ts';
import { catalogReady } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'desktop-catalog',
  ...DESKTOP,
  path: '/?view=list',
  async setup(page) {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  async ready(page, gif) {
    await catalogReady(page, gif);
    await page.waitForTimeout(1200);
    await gif.glide(page, { x: 640, y: 420 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(1500);
    const filters = page.getByRole('button', { name: /^Filters/ });
    if (await filters.isVisible()) {
      await gif.click(page, filters, { ms: 700 });
      await page.waitForTimeout(1000);
      const sheet = page.getByRole('dialog', { name: 'Filters' });
      await gif.click(
        page,
        sheet.getByRole('group', { name: 'What' }).getByRole('button', { name: 'Hikes' }),
        { ms: 700 },
      );
      await page.waitForTimeout(700);
      await gif.click(page, sheet.getByRole('button', { name: /^Show \d+ place/ }), { ms: 700 });
    } else {
      // Main: the category pill.
      await page.getByRole('combobox', { name: 'Category' }).selectOption('hiking');
    }
    await page.waitForTimeout(1500);
    await gif.click(page, page.locator('[data-activity-id] button').first(), { ms: 800 });
    await page.waitForTimeout(1500);
    await gif.scroll(page, 500, 1400);
    await page.waitForTimeout(1500);
  },
};

export default scenario;
