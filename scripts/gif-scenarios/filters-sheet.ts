// The phone's Filters sheet: on main every option a wrapping chip, seven
// durations among them, in a sheet that scrolls; on the branch (#292) the
// categories as tiles, distance and four durations as segments, switches,
// and park type as a row opening its own list, all on one screen. Each
// picks hikes, a few hours' worth (1-2 Hours on main), dogs welcome and a
// state park, then shows the places.
//
//   npm run gif -- scripts/gif-scenarios/filters-sheet.ts --dir <PR number>
//
// Production's catalog, signed out.

import type { Locator } from '@playwright/test';
import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const scenario: Scenario = {
  name: 'filters-sheet',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    // Production has no dog rules pages (#296) yet.
    await liveCatalog(page, { dogRulesUrl: () => null });
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(600);
    await gif.click(page, page.getByRole('button', { name: /^Filters/ }), { ms: 700 });
    await page.waitForTimeout(900);
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    const onBranch = await sheet.getByRole('group', { name: 'What' }).isVisible();
    const pick = async (target: Locator) => {
      await gif.click(page, target, { ms: 600 });
      await page.waitForTimeout(450);
    };
    if (onBranch) {
      await pick(sheet.getByRole('group', { name: 'What' }).getByRole('button', { name: 'Hikes' }));
      await pick(
        sheet.getByRole('group', { name: 'How long' }).getByRole('button', { name: 'A few hours' }),
      );
      await pick(sheet.getByRole('switch', { name: 'Dogs welcome' }));
      await pick(sheet.getByRole('button', { name: /^Park type/ }));
      await pick(page.getByRole('button', { name: 'State park', exact: true }));
    } else {
      await pick(
        sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Hiking' }),
      );
      await pick(
        sheet.getByRole('group', { name: 'How long' }).getByRole('button', { name: '1-2 Hours' }),
      );
      await pick(sheet.getByRole('checkbox', { name: 'Dog friendly' }));
      // The rest is below the fold.
      await gif.scroll(page, 360, 900);
      await page.waitForTimeout(400);
      await pick(
        sheet.getByRole('group', { name: 'Park type' }).getByRole('button', { name: 'State park' }),
      );
    }
    await page.waitForTimeout(600);
    await gif.click(page, sheet.getByRole('button', { name: /^Show \d+ place/ }), { ms: 700 });
    await page.waitForTimeout(1600);
  },
};

export default scenario;
