// The catalog on a phone: on main a three-row header, one big card to a
// row, and the map behind Show map; on the branch a one-line header, two
// cards to a row with their facts on the photo (#290), and a tab bar at the
// foot whose Map tab opens the map, its list sheet sitting on the bar (#289).
//
//   npm run gif -- scripts/gif-scenarios/phone-tabs.ts
//
// Production's catalog, signed out.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';

const scenario: Scenario = {
  name: 'phone-tabs',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(1200);
    const tabs = page.getByRole('navigation', { name: 'Main' });
    const onBranch = await tabs.isVisible();
    const toMap = onBranch
      ? tabs.getByRole('link', { name: 'Map' })
      : page.getByRole('button', { name: 'Show map' });
    await gif.click(page, toMap, { ms: 800 });
    await page.waitForTimeout(1500);
    const toList = onBranch
      ? tabs.getByRole('link', { name: 'Places' })
      : page.getByRole('button', { name: 'Hide map' }).first();
    await gif.click(page, toList, { ms: 800 });
    await page.waitForTimeout(1200);
  },
};

export default scenario;
