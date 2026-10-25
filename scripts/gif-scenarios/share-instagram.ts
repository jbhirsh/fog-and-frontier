// Sharing an Instagram reel to the app (#6), on a phone: the reel is read,
// its places listed, and one added through the usual dialog.
//
//   npm run gif -- scripts/gif-scenarios/share-instagram.ts --dir <PR number> --after-only
//
// The post card is a real reel, as the reader reads it, and the draft's
// cover is the real lookup's (findCoverImage, as generateActivity does it).
// The places and the rest of the draft are stubbed: Gemini's answers need
// its key, which only the deployment has, so they're written out by hand.
// A food event has no AllTrails link; generateActivity gives one only for a
// trail it found.

import type { Page } from '@playwright/test';
import { findCoverImage } from '../../api/_coverImage.ts';
import { parseInstagramUrl, readInstagramPost } from '../../api/_instagram.ts';
import { mockApis, signIn } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';

const REEL = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';

const FOUND = {
  __typename: 'SharedPlacesPayload',
  post: {
    __typename: 'SharedPost',
    url: REEL,
    author: 'truly_athi',
    caption:
      'One of the newest + best weekend events in the Bay Area comes with FREE admission, FREE ferry rides, Live music & 15+ food vendors. Amazing SF views.',
    imageUrl: null as string | null,
    isVideo: true,
  },
  places: [
    {
      __typename: 'SharedPlace',
      name: 'Off the Grid: Treasure Island',
      city: 'San Francisco',
      lat: 37.8235,
      lng: -122.3706,
      detail: 'Saturday food trucks and live music in Cityside Park, with free ferry rides',
      source: 'caption',
      saved: null,
    },
    {
      __typename: 'SharedPlace',
      name: 'Treasure Island Ferry',
      city: 'San Francisco',
      lat: 37.8233,
      lng: -122.3717,
      detail: 'The ferry over from the Ferry Building, shown on screen',
      source: 'on_screen',
      saved: null,
    },
  ],
  read: { __typename: 'SharedRead', caption: true, video: true, geotag: true },
};

const DRAFT = {
  __typename: 'GeneratedActivity',
  name: 'Off the Grid: Treasure Island',
  shortDescription: 'Saturday food trucks, live music and Bay views on Treasure Island',
  longDescription:
    'Off the Grid brings 15+ food vendors and live music to Cityside Park on Treasure Island every Saturday, with views of the Bay Bridge and the Golden Gate. Free admission, and free ferry rides from the Ferry Building.',
  category: 'food',
  region: 'sf',
  parkType: null,
  city: 'San Francisco',
  lat: 37.8235,
  lng: -122.3706,
  duration: 'Half Day',
  durationDetail: 'Saturdays, 11 AM–4 PM',
  difficulty: null,
  dogFriendly: true,
  hikeDistanceMiles: null,
  hikeElevationFeet: null,
  cuisine: 'Food trucks',
  priceRange: null,
  costTier: '$',
  hours: 'Sat 11 AM–4 PM',
  reservationUrl: null,
  menuUrl: null,
  dietary: null,
  allTrailsUrl: null,
  notes: `From an Instagram reel by @truly_athi: ${REEL}`,
  coverImage: null as string | null,
  coverCredit: null as string | null,
};

/** Answers the share's two Gemini calls, taking about as long as Gemini does. */
async function stubGemini(
  page: Page,
  poster: string | null,
  cover: { url: string; credit: string } | null,
) {
  await page.route('**/api/graphql', async (route) => {
    const op = (route.request().postDataJSON() as { operationName?: string } | null)?.operationName;
    if (op === 'FindSharedPlaces') {
      await new Promise((r) => setTimeout(r, 2500));
      const found = { ...FOUND, post: { ...FOUND.post, imageUrl: poster } };
      return route.fulfill({ json: { data: { findSharedPlaces: found } } });
    }
    if (op === 'GenerateActivity') {
      await new Promise((r) => setTimeout(r, 1800));
      return route.fulfill({
        json: {
          data: {
            generateActivity: {
              __typename: 'GenerateActivityPayload',
              activity: {
                ...DRAFT,
                coverImage: cover?.url ?? null,
                coverCredit: cover?.credit ?? null,
              },
            },
          },
        },
      });
    }
    return route.fallback();
  });
}

const scenario: Scenario = {
  name: 'share-instagram',
  path: `/share?url=${encodeURIComponent(REEL)}`,
  viewport: { width: 390, height: 760 },
  clip: { x: 0, y: 0, width: 390, height: 760 },
  width: 390,
  async setup(page) {
    await mockApis(page);
    await signIn(page);
    // The reel's own poster, as the reader finds it (its link expires).
    const { post } = await readInstagramPost(parseInstagramUrl(REEL)!);
    const cover = await findCoverImage({
      name: DRAFT.name,
      lat: DRAFT.lat,
      lng: DRAFT.lng,
      category: 'food',
    });
    await stubGemini(page, post.imageUrl ?? null, cover);
  },
  async ready(page, gif) {
    await page.getByRole('status').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await gif.glide(page, { x: 300, y: 600 }, 0);
  },
  async play(page, gif) {
    await page.getByRole('heading', { name: '2 places in this post' }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await gif.click(page, page.getByRole('button', { name: 'Add Off the Grid: Treasure Island' }), {
      ms: 700,
    });
    await page.getByRole('button', { name: /Save activity/ }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1800);
  },
};

export default scenario;
