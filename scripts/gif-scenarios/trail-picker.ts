// A drafted hike's trail as a card, and the others its search found (#6):
// an owner drafts Alamere Falls, finds its trail drawn under the AllTrails
// URL field, opens "Not the right trail?" and selects another.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/trail-picker.ts --dir <PR number>
//
// Gemini's draft is stubbed (its key is only on the deployment), and with it
// the trails its search found: their names and addresses are AllTrails'
// own, their descriptions and numbers stand-ins, and only the first has a
// picture, Wikimedia's photo of the falls. On main the field is a bare
// address; on the branch it's a card, with the others to choose from.

import { mockApis, signIn } from '../../tests/visual/helpers';
import { click, glide, scroll, type Scenario } from '../pr-gif.ts';
import { draftActivity, readyToAdd, stubDraft } from './stub-draft.ts';

const T = 'https://www.alltrails.com/trail/us/california/';
const PICK = `${T}alamere-falls-via-coast-trail-from-palomarin-trailhead`;

const OPTIONS = [
  {
    url: PICK,
    title: 'Alamere Falls via Coast Trail from Palomarin Trailhead',
    description:
      'Head out on this out-and-back trail near Bolinas, California, along the Coast Trail past Bass Lake to the falls.',
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/AlamereFalls.JPG/330px-AlamereFalls.JPG',
    rating: 4.7,
    reviews: 6412,
    miles: 8.4,
    feet: 1640,
  },
  {
    url: `${T}alamere-falls-and-wildcat-camp-via-bear-valley-trail`,
    title: 'Alamere Falls and Wildcat Camp via Bear Valley Trail',
    description: 'A longer way in from Bear Valley, by Wildcat Camp and the beach.',
    image: null,
    rating: 4.6,
    reviews: 1088,
    miles: 13.4,
    feet: 2034,
  },
  {
    url: `${T}wildcat-camp-trail-to-alamere-falls`,
    title: 'Wildcat Camp Trail to Alamere Falls',
    description: 'From Wildcat Camp along the beach to the falls.',
    image: null,
    rating: 4.8,
    reviews: 532,
    miles: 5.6,
    feet: 905,
  },
].map((o) => ({ __typename: 'TrailOption', ...o }));

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
  hikeDistanceMiles: null,
  hikeElevationFeet: null,
  cuisine: null,
  priceRange: null,
  costTier: 'free',
  hours: null,
  reservationUrl: null,
  menuUrl: null,
  dietary: null,
  allTrailsUrl: PICK,
  allTrailsOptions: OPTIONS,
  notes: null,
  coverImage: null,
  coverCredit: null,
  parentId: null,
};

const scenario: Scenario = {
  name: 'trail-picker',
  path: '/?view=list',
  viewport: { width: 1000, height: 820 },
  clip: { x: 0, y: 0, width: 1000, height: 820 },
  width: 800,
  async setup(page) {
    await mockApis(page);
    await signIn(page);
    // No cover: this is about the trail, and Commons is asked no more.
    await stubDraft(page, DRAFT, 1000, { cover: false });
  },
  ready: readyToAdd,
  async run(page) {
    await draftActivity(page, 'Alamere Falls');

    // Down the review to the AllTrails URL field, by just as far as it is,
    // the pointer high enough that the map under the field never passes
    // under it (the wheel would zoom the map instead).
    const field = page.getByLabel('AllTrails URL');
    await glide(page, { x: 500, y: 200 }, 400);
    await scroll(page, (await field.boundingBox())!.y - 150);
    await page.waitForTimeout(1200);

    // Main: the address is all there is.
    const others = page.getByRole('button', { name: /Not the right trail/ });
    if ((await others.count()) === 0) {
      const box = (await field.boundingBox())!;
      await glide(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 600);
      await page.waitForTimeout(2500);
      return;
    }

    // Branch: the card, then the others, and another selected.
    await page.waitForTimeout(800);
    await click(page, others, { ms: 600 });
    await page.waitForTimeout(1200);
    await scroll(page, 220);
    await page.waitForTimeout(600);
    await click(page, page.getByText('Wildcat Camp Trail to Alamere Falls'), { ms: 700 });
    await page.waitForTimeout(1200);
    await click(page, page.getByRole('button', { name: 'Done ▴' }), { ms: 600 });
    await page.waitForTimeout(400);
    // Back up to the card, now the trail selected.
    await glide(page, { x: 500, y: 200 }, 500);
    await scroll(page, (await field.boundingBox())!.y - 150);
    await page.waitForTimeout(1800);
  },
};

export default scenario;
