// Region from anywhere (#274): an owner drafts a place in Kyoto, which the
// draft could only file under a California area before, and finds its real
// region by typing it.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/region-anywhere.ts --dir <PR number>
//
// Gemini's draft is stubbed (its key is only on the deployment), filed under
// SoCal as main's region list forced, with the cover the real lookup finds.
// On main the Region field is a menu of West Coast areas, with nothing
// nearer; on the branch it's a search over every region in the world.

import { mockApis, signIn } from '../../tests/visual/helpers';
import { click, glide, scroll, type Scenario } from '../pr-gif.ts';
import { stubDraft } from './stub-draft.ts';

const DRAFT = {
  name: 'Fushimi Inari Taisha',
  shortDescription:
    'Thousands of vermilion torii gates climbing the forested slopes of Mount Inari above Kyoto.',
  longDescription:
    'The head shrine of Inari, founded in 711, with a trail of some ten thousand torii winding up Mount Inari past fox statues and small shrines to views over Kyoto.',
  category: 'hiking',
  region: 'socal',
  parkType: null,
  city: 'Kyoto',
  lat: 34.9671,
  lng: 135.7727,
  duration: 'Half Day',
  durationDetail: '2–3 hours to the summit and back',
  difficulty: 'moderate',
  dogFriendly: false,
  hikeDistanceMiles: null,
  hikeElevationFeet: null,
  cuisine: null,
  priceRange: null,
  costTier: 'free',
  hours: 'Open 24 hours',
  reservationUrl: null,
  menuUrl: null,
  dietary: null,
  allTrailsUrl: null,
  notes: null,
  parentId: null,
};

const scenario: Scenario = {
  name: 'region-anywhere',
  path: '/?view=list',
  viewport: { width: 1000, height: 760 },
  clip: { x: 0, y: 0, width: 1000, height: 760 },
  width: 800,
  async setup(page) {
    await mockApis(page);
    await signIn(page);
    await stubDraft(page, DRAFT, 1000);
  },
  async ready(page) {
    await page.getByRole('button', { name: 'Add activity' }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await glide(page, { x: 500, y: 400 }, 0);
  },
  async run(page) {
    await page.waitForTimeout(400);
    await click(page, page.getByRole('button', { name: 'Add activity' }).first(), { ms: 600 });
    await page.getByLabel('Title').waitFor();
    await click(page, page.getByLabel('Title'), { ms: 400 });
    await page.keyboard.type('Fushimi Inari', { delay: 40 });
    await page.waitForTimeout(300);
    await click(page, page.getByRole('button', { name: /Generate/ }), { ms: 500 });
    await page.getByLabel('Short description').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);

    // Down the review to Region.
    // Main's menu takes in its label's text and its options', so it's found by
    // the start of its name; the branch's search is named Region alone.
    const region = page.getByRole('combobox', { name: /^Region/ });
    for (let i = 0; i < 6; i++) {
      const box = await region.boundingBox();
      if (box && box.y > 200 && box.y < 520) break;
      await scroll(page, 220);
      await page.waitForTimeout(250);
    }
    const box = (await region.boundingBox())!;
    await glide(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 600);
    await page.waitForTimeout(800);

    if ((await region.evaluate((el) => el.tagName)) === 'SELECT') {
      // Main: a menu of West Coast areas, SoCal the nearest it has. A native
      // menu opens outside the page, where no recording sees it, so it's
      // shown open in place: every option it has, at once.
      await click(page, region, { ms: 300 });
      await region.evaluate((el) => {
        const menu = el as HTMLSelectElement;
        menu.size = menu.options.length;
        menu.style.height = 'auto';
        menu.style.backgroundImage = 'none';
      });
      await page.waitForTimeout(3500);
      return;
    }
    await click(page, region, { ms: 300 });
    await page.waitForTimeout(600);
    await page.keyboard.type('kyo', { delay: 160 });
    await page.waitForTimeout(900);
    await click(page, page.getByRole('option', { name: 'Kyoto, Japan' }), { ms: 500 });
    await page.waitForTimeout(1800);
  },
};

export default scenario;
