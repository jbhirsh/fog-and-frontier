// Add's Review & save on a phone, scrolled the length of a long draft: on
// main, Back and Save sit at the very end; on the branch they stay pinned to
// the bottom of the dialog the whole way (#287).
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/review-footer.ts --dir <PR number>
//
// Gemini's draft is stubbed (its key is only on the deployment), with no
// cover, so Commons isn't asked.

import { mockApis, signIn } from '../../tests/visual/helpers';
import { glide, scroll, type Scenario } from '../pr-gif.ts';
import { draftActivity, stubDraft } from './stub-draft.ts';

const DRAFT = {
  __typename: 'GeneratedActivity',
  name: 'Alamere Falls',
  shortDescription: 'A coastal hike to a waterfall that pours straight onto Wildcat Beach.',
  longDescription:
    'In the Phillip Burton Wilderness of Point Reyes National Seashore, one of the few waterfalls in California to fall onto a beach.',
  category: 'hiking',
  region: 'north-bay',
  parkType: 'national',
  city: 'Bolinas',
  lat: 37.934,
  lng: -122.7468,
  duration: 'Full Day',
  durationDetail: null,
  difficulty: 'moderate',
  dogFriendly: false,
  hikeDistanceMiles: 8.4,
  hikeElevationFeet: 1640,
  cuisine: null,
  priceRange: null,
  costTier: 'free',
  hours: null,
  reservationUrl: null,
  menuUrl: null,
  dietary: null,
  allTrailsUrl: null,
  allTrailsOptions: [],
  notes: 'Time it for low tide: the last mile is along the beach.',
  coverImage: null,
  coverCredit: null,
  parentId: null,
};

const scenario: Scenario = {
  name: 'review-footer',
  path: '/?view=list',
  viewport: { width: 390, height: 844 },
  clip: { x: 0, y: 0, width: 390, height: 844 },
  width: 390,
  async setup(page) {
    await mockApis(page);
    await signIn(page);
    await stubDraft(page, DRAFT, 800, { cover: false });
  },
  async ready(page) {
    await page.getByRole('button', { name: 'Add activity' }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await glide(page, { x: 200, y: 420 }, 0);
  },
  async run(page) {
    await draftActivity(page, 'Alamere Falls');
    // Down the whole draft, the pointer over the dialog, then a pause on
    // where Save is.
    await glide(page, { x: 200, y: 420 }, 400);
    for (let i = 0; i < 6; i++) {
      await scroll(page, 450);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
  },
};

export default scenario;
