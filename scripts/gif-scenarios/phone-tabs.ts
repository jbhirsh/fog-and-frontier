// The catalog on a phone: on main a three-row header, one big card to a
// row, and the map behind Show map; on the branch a one-line header, two
// cards to a row with their facts on the photo (#290), and a tab bar at the
// foot whose Map tab opens the map, its list sheet sitting on the bar (#289).
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/phone-tabs.ts --dir <PR number>
//
// Production's catalog, signed out. Until the card copy (#295) is saved,
// production has none, so each card's line is its short description cut at
// a word to fit.

import { mockApis } from '../../tests/visual/helpers';
import { click, type Scenario } from '../pr-gif.ts';
import { PHONE, catalogReady } from './phone.ts';
import { liveCatalog } from './live-catalog.ts';

const LINE_MAX = 50;

function cardLine(activity: { id: string }): string | null {
  const description = (activity as { shortDescription?: string }).shortDescription ?? '';
  let line = '';
  for (const word of description.replace(/[.!]+$/, '').split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > LINE_MAX) break;
    line = next;
  }
  return line.replace(/[,;:]$/, '') || null;
}

const scenario: Scenario = {
  name: 'phone-tabs',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    await liveCatalog(page, { cardLine, cardName: () => null });
  },
  ready: catalogReady,
  async run(page) {
    await page.waitForTimeout(1200);
    const tabs = page.getByRole('navigation', { name: 'Main' });
    const onBranch = await tabs.isVisible();
    const toMap = onBranch
      ? tabs.getByRole('link', { name: 'Map' })
      : page.getByRole('button', { name: 'Show map' });
    await click(page, toMap, { ms: 800 });
    await page.waitForTimeout(1500);
    const toList = onBranch
      ? tabs.getByRole('link', { name: 'Places' })
      : page.getByRole('button', { name: 'Hide map' }).first();
    await click(page, toList, { ms: 800 });
    await page.waitForTimeout(1200);
  },
};

export default scenario;
