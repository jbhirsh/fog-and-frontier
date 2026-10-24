// The review step of Add activity, on a phone, with a drafted short
// description longer than one line: cut off before, wrapped to show all of
// it after.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/review-short-description.ts --dir <PR number>
//
// Gemini's draft is stubbed (its key is only on the deployment), with the
// cover the real lookup finds (findCoverImage, as generateActivity does).

import { mockApis, signIn } from '../../tests/visual/helpers';
import { click, glide, type Scenario } from '../pr-gif.ts';
import { liveCatalog } from './live-catalog.ts';
import { stubDraft } from './stub-draft.ts';

const DRAFT = {
  name: 'Castle Rock State Park',
  shortDescription:
    'Sandstone caves, a seasonal waterfall and views to Monterey Bay on a ridge-top loop in the Santa Cruz Mountains',
  longDescription:
    'A loop through oak and madrone woods to Castle Rock and Goat Rock, wind-carved sandstone outcrops popular with climbers, past Castle Rock Falls and out along the Saratoga Gap Trail for views down to Monterey Bay.',
  category: 'hiking',
  region: 'south-bay',
  parkType: 'state',
  city: 'Los Gatos',
  lat: 37.2309,
  lng: -122.0956,
  duration: 'Half Day',
  durationDetail: '2–3 hours',
  difficulty: 'moderate',
  dogFriendly: false,
  hikeDistanceMiles: null,
  hikeElevationFeet: null,
  cuisine: null,
  priceRange: null,
  costTier: 'free',
  hours: null,
  reservationUrl: null,
  menuUrl: null,
  dietary: null,
  allTrailsUrl: null,
  notes: null,
};

const scenario: Scenario = {
  name: 'review-short-description',
  path: '/?view=list',
  viewport: { width: 390, height: 760 },
  clip: { x: 0, y: 0, width: 390, height: 760 },
  width: 390,
  async setup(page) {
    await mockApis(page);
    await signIn(page);
    // Production lacks the branch's sourceUrl: its real catalog, without it.
    await liveCatalog(page, { sourceUrl: () => null });
    await stubDraft(page, DRAFT, 1200);
  },
  async ready(page) {
    await page.getByRole('button', { name: 'Add activity' }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await glide(page, { x: 300, y: 400 }, 0);
  },
  async run(page) {
    await page.waitForTimeout(400);
    await click(page, page.getByRole('button', { name: 'Add activity' }).first(), { ms: 600 });
    await page.getByLabel('Title').waitFor();
    await click(page, page.getByLabel('Title'), { ms: 400 });
    await page.keyboard.type('Castle Rock State Park', { delay: 40 });
    await page.waitForTimeout(300);
    await click(page, page.getByRole('button', { name: /Generate/ }), { ms: 500 });
    await page.getByLabel('Short description').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    const box = (await page.getByLabel('Short description').boundingBox())!;
    await glide(page, { x: box.x + box.width - 40, y: box.y + box.height / 2 }, 600);
    await page.waitForTimeout(2000);
  },
};

export default scenario;
