// The visual tests' trip on production's places: its days, times and votes
// as the stub has them, each place swapped for one of production's own, so
// a recording shows their names and photos rather than the stub's blank
// covers. Trips need a real sign-in, so the trip itself stays the stub's.
// Call from a scenario's setup, after mockApis and signIn.

import type { Page } from '@playwright/test';
import { mockApis, signIn, toTripRow } from '../../tests/visual/helpers';
import type { Gif } from '../gif-types.ts';
import { fixtureTrips } from '../../tests/visual/fixtures';
import { LIVE_GRAPHQL } from '../live-site.ts';

// What a place's row and card read, as production serves it.
const PLACES = `query Activities { activities { id name shortDescription category region
  location { city coords { lat lng } } duration dogFriendly coverImage coverCredit
  allTrailsRating } }`;

interface Place {
  id: string;
  name: string;
  region: string;
  coverImage: string | null;
}

export async function liveTrip(page: Page): Promise<void> {
  let places: Place[] | null = null;
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string;
      variables?: { id?: string };
    } | null;
    const trip = fixtureTrips[body?.variables?.id ?? ''];
    if (body?.operationName !== 'TripDetail' || !trip) return route.fallback();
    if (!places) {
      const response = await route.fetch({
        url: LIVE_GRAPHQL,
        postData: JSON.stringify({ operationName: 'Activities', query: PLACES }),
      });
      const json = (await response.json()) as { data?: { activities?: Place[] } };
      // Around the Bay, with a photo, in a steady order.
      places = (json.data?.activities ?? [])
        .filter((p) => p.coverImage && ['sf', 'north-bay', 'peninsula'].includes(p.region))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const row = toTripRow(trip);
    const real = places;
    const activities = row.activities.map((a, i) => {
      const place = real[(i * 7) % real.length];
      return place ? { ...a, snapshot: { ...a.snapshot, ...place, id: a.snapshot.id } } : a;
    });
    return route.fulfill({ json: { data: { trip: { ...row, activities } } } });
  });
}

/** A trip scenario's page and setup: the planning trip, signed in, on production's places. */
export const LIVE_TRIP = {
  path: '/trips/fixture-trip-planning',
  async setup(page: Page): Promise<void> {
    await mockApis(page);
    await signIn(page);
    await liveTrip(page);
  },
};

/** Ready once the trip's title and fonts are in and its photos have had `settle` ms. */
export async function tripReady(
  page: Page,
  gif: Gif,
  pointer: { x: number; y: number },
  settle: number,
): Promise<void> {
  await page.getByRole('heading', { name: 'Coast Weekend' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settle);
  await gif.glide(page, pointer, 0);
}
