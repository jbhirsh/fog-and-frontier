// An activity's link back to the post it was added from (#6), in its detail.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/source-link.ts --dir <PR number> --after-only
//
// Production's catalog, with one activity given a source: no saved activity
// has one until sharing ships, so it's added for the recording.

import { mockApis } from '../../tests/visual/helpers';
import { glide, scroll, type Scenario } from '../pr-gif.ts';
import { liveCatalog } from './live-catalog.ts';

const ACTIVITY = 'molinari-s-deli';
const REEL = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';

const scenario: Scenario = {
  name: 'source-link',
  path: `/activity/${ACTIVITY}`,
  viewport: { width: 390, height: 760 },
  clip: { x: 0, y: 0, width: 390, height: 760 },
  width: 390,
  async setup(page) {
    await mockApis(page);
    await liveCatalog(page, { sourceUrl: (a) => (a.id === ACTIVITY ? REEL : null) });
  },
  async ready(page) {
    await page.getByRole('link', { name: /Seen on Instagram/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await glide(page, { x: 200, y: 600 }, 0);
  },
  async run(page) {
    await page.waitForTimeout(600);
    // Down to the links, where the source sits after the notes.
    const link = page.getByRole('link', { name: /Seen on Instagram/ });
    for (
      let i = 0;
      i < 6 && !((await link.isVisible()) && (await link.boundingBox())!.y < 600);
      i++
    ) {
      await scroll(page, 300);
      await page.waitForTimeout(250);
    }
    const box = (await link.boundingBox())!;
    await glide(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 600);
    await page.waitForTimeout(1500);
  },
};

export default scenario;
