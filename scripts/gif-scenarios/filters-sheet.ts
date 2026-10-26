// The catalog's filters on a phone: on main a row of seven pickers that
// scrolls sideways; on the branch one Filters button, whose sheet holds them
// all, and a chip under it for each filter on.
//
//   npm run gif -- scripts/gif-scenarios/filters-sheet.ts --dir <PR number>
//
// Production's catalog, signed out.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';

const scenario: Scenario = {
  name: 'filters-sheet',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(600);
    const filters = page.getByRole('button', { name: /^Filters/ });
    if (!(await filters.isVisible())) {
      // Main: the pickers run off the screen, and scroll sideways to reach.
      // scroll() only goes up and down, so the wheel steps sideways here by
      // the clock, as it does.
      const row = page.getByRole('combobox', { name: 'Distance' });
      const box = await row.boundingBox();
      if (box) await gif.glide(page, { x: 300, y: box.y + box.height / 2 }, 600);
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(30, 0);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(1200);
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(-30, 0);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(1500);
      return;
    }
    await gif.click(page, filters, { ms: 700 });
    await page.waitForTimeout(700);
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await gif.click(
      page,
      sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Hiking' }),
      {
        ms: 600,
      },
    );
    await page.waitForTimeout(400);
    await gif.click(
      page,
      sheet
        .getByRole('group', { name: 'How far' })
        .getByRole('button', { name: '50 mi', exact: true }),
      {
        ms: 600,
      },
    );
    await page.waitForTimeout(400);
    await gif.click(page, sheet.getByRole('checkbox', { name: 'Dog friendly' }), { ms: 600 });
    await page.waitForTimeout(600);
    await gif.click(page, sheet.getByRole('button', { name: /^Show \d+ place/ }), { ms: 700 });
    await page.waitForTimeout(900);
    await gif.click(page, page.getByRole('button', { name: 'Remove filter: Within 50 mi' }), {
      ms: 700,
    });
    await page.waitForTimeout(1500);
  },
};

export default scenario;
