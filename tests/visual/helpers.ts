import { expect, type Page } from '@playwright/test';
import {
  FIXTURE_EMAIL,
  FIXTURE_TRIP_CREATED_AT,
  fixtureActivities,
  fixtureCompleted,
  fixtureTripMembers,
  fixtureTrips,
  type FixtureTrip,
} from './fixtures';
import type { Activity } from '../../src/data/types';
import { distanceMiles } from '../../src/data/home';

// 1x1 transparent PNG. Returned for every external image so screenshots don't
// depend on the network or on which remote photos happen to load.
const BLANK_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

// Same blank PNG as a data URL — used by `seedPhotos` when we want the user
// photo store pre-populated before the page boots.
const BLANK_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

// Domain Activity -> the GraphQL `Activity` row the client now reads: camelCase
// fields + the __typenames the Apollo cache needs on every (nested) object.
// Mirrors src/test/render.tsx's toActivityRow; fixtures predate parkType /
// restaurant fields, so those default to null.
function toActivityRow(a: Activity) {
  return {
    __typename: 'Activity',
    id: a.id,
    name: a.name,
    shortDescription: a.shortDescription,
    longDescription: a.longDescription ?? null,
    category: a.category,
    region: a.region,
    parkType: a.parkType ?? null,
    location: {
      __typename: 'Location',
      city: a.location.city,
      coords: {
        __typename: 'Coords',
        lat: a.location.coords.lat,
        lng: a.location.coords.lng,
      },
    },
    duration: a.duration,
    durationDetail: a.durationDetail ?? null,
    difficulty: a.difficulty ?? null,
    dogFriendly: a.dogFriendly ?? null,
    coverImage: a.coverImage,
    coverCredit: a.coverCredit ?? null,
    galleryImages: a.galleryImages ?? null,
    allTrailsUrl: a.allTrailsUrl ?? null,
    allTrailsRating: a.allTrailsRating ?? null,
    hikeDistanceMiles: a.hikeDistanceMiles ?? null,
    hikeElevationFeet: a.hikeElevationFeet ?? null,
    cuisine: a.cuisine ?? null,
    priceRange: a.priceRange ?? null,
    hours: a.hours ?? null,
    reservationUrl: a.reservationUrl ?? null,
    menuUrl: a.menuUrl ?? null,
    dietary: a.dietary ?? null,
    completed: a.completed ?? null,
    completedDate: a.completedDate ?? null,
    notes: a.notes ?? null,
  };
}

// GraphQL rows for the fixture trips (#59), with the __typenames the Apollo
// cache needs.
function toTripListRow(t: FixtureTrip) {
  const scheduled = t.activities.filter((a) => a.dayIndex !== null).length;
  return {
    __typename: 'TripListItem',
    id: t.id,
    creatorEmail: FIXTURE_EMAIL,
    title: t.title,
    description: t.description,
    startDate: t.startDate,
    endDate: t.endDate,
    coverImageUrl: null,
    status: t.status,
    createdAt: FIXTURE_TRIP_CREATED_AT,
    markedPastAt: null,
    scheduledCount: scheduled,
    unscheduledCount: t.activities.length - scheduled,
  };
}

function toTripRow(t: FixtureTrip) {
  return {
    __typename: 'Trip',
    id: t.id,
    creatorEmail: FIXTURE_EMAIL,
    title: t.title,
    description: t.description,
    startDate: t.startDate,
    endDate: t.endDate,
    coverImageUrl: null,
    status: t.status,
    createdAt: FIXTURE_TRIP_CREATED_AT,
    markedPastAt: null,
    activities: t.activities.map((a) => ({
      __typename: 'TripActivity',
      id: a.id,
      tripId: t.id,
      activityId: a.activityId,
      addedByEmail: a.addedByEmail,
      addedAt: FIXTURE_TRIP_CREATED_AT,
      dayIndex: a.dayIndex,
      startTime: a.startTime,
      displayOrder: a.displayOrder,
      snapshot: { ...toActivityRow(fixtureActivities[a.activityId]), __typename: 'ActivitySnapshot' },
    })),
    members: fixtureTripMembers.map((m) => ({ __typename: 'TripMember', ...m })),
    invites: [],
    votes: t.votes.map((v) => ({ __typename: 'TripVote', ...v })),
  };
}

// Signs the page in as the fixture member (dev/test-only flag in
// src/lib/authShim.ts), so the trips pages render their signed-in views.
// The fixture member is also an owner (they can create trips), so the owner
// flag is set too.
export async function signIn(page: Page) {
  await page.addInitScript((email) => {
    const w = window as { __TEST_FORCE_EMAIL__?: string; __TEST_FORCE_OWNER__?: boolean };
    w.__TEST_FORCE_EMAIL__ = email;
    w.__TEST_FORCE_OWNER__ = true;
  }, FIXTURE_EMAIL);
}

// Trips views (#59), shared by the desktop and mobile specs: the list, the
// create form, and a trip's detail page in its planning and voting states.
export const TRIP_VIEWS = [
  { name: 'trips-list', path: '/trips', map: false },
  { name: 'trips-new', path: '/trips/new', map: false },
  { name: 'trip-planning', path: '/trips/fixture-trip-planning', map: true },
  { name: 'trip-voting', path: '/trips/fixture-trip-voting', map: false },
] as const;

export async function settleTripView(page: Page, map: boolean) {
  await waitForVisualReady(page);
  if (map) {
    await page.locator('.leaflet-container').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
  }
}

export async function mockApis(page: Page) {
  // Distances measure from the visitor once they share a location (#66). Pin
  // the snapshots to the "declined" answer so they always read "from
  // San Jose", whatever a headless browser does with the location prompt.
  await page.addInitScript(() => {
    localStorage.setItem('fogandfrontier.location.v1', 'denied');
  });
  // The client now talks to the single GraphQL endpoint — route by operationName
  // (the old per-route REST mocks are gone with the 11 handlers).
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string;
      variables?: { lat?: number; lng?: number; id?: string };
    } | null;
    const op = body?.operationName;
    let data: Record<string, unknown> = {};
    switch (op) {
      case 'Activities':
        data = {
          activities: Object.values(fixtureActivities).map(toActivityRow),
        };
        break;
      case 'Completed':
        data = {
          completed: Object.entries(fixtureCompleted).map(([id, completed]) => ({
            __typename: 'CompletedEntry',
            id,
            completed,
          })),
        };
        break;
      case 'ActivityReviews':
        // No fixture reviews: the section is owner-only until one exists, so
        // the default (non-owner) baselines stay unchanged (#184).
        data = { activityReviews: [] };
        break;
      case 'TripsList':
        data = { trips: Object.values(fixtureTrips).map(toTripListRow) };
        break;
      case 'TripDetail': {
        const trip = fixtureTrips[body?.variables?.id ?? ''];
        data = { trip: trip ? toTripRow(trip) : null };
        break;
      }
      case 'UsersList':
        data = { users: [] };
        break;
      case 'DrivingMiles': {
        // Road miles (#66): a deterministic stand-in, 1.3x the straight line,
        // so snapshots show the loaded state rather than the "≈" estimate.
        const from = { lat: body?.variables?.lat ?? 0, lng: body?.variables?.lng ?? 0 };
        data = {
          drivingMiles: Object.values(fixtureActivities).map((a) => ({
            __typename: 'DrivingDistance',
            id: a.id,
            miles: Math.round(distanceMiles(from, a.location.coords) * 13) / 10,
          })),
        };
        break;
      }
      case 'Discover':
        data = {
          discover: {
            __typename: 'DiscoverResult',
            range: 'weekend',
            events: [],
            sources: [],
          },
        };
        break;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data }),
    });
  });
  // Stub every external image with a 1x1 PNG so the page reaches a stable
  // visual state regardless of remote latency. Without this, lazy-loaded cover
  // images keep mutating the page and `toHaveScreenshot` times out trying to
  // capture two consecutive identical frames.
  //
  // Also stub all Google Fonts requests (CSS + font binaries) with empty
  // bodies. With no @font-face declarations, the page renders entirely with
  // browser-default sans-serif. That makes the screenshots deterministic
  // across environments — production uses webfonts, but tests should never
  // depend on the font CDN being reachable from a CI runner.
  await page.route(/^https?:\/\/(?!localhost)/i, async (route) => {
    const url = route.request().url();
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: url.includes('.css') || url.includes('css2') ? 'text/css' : 'font/woff2',
        body: '',
      });
      return;
    }
    if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: BLANK_PNG_BYTES,
      });
      return;
    }
    await route.continue();
  });
}

export async function waitForVisualReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Settle any layout from late-loading icons
  await page.waitForTimeout(200);
}

// Pre-populate the user-photo store so the "Your Photos" section renders with
// real thumbnails on first paint. Storage key must match src/lib/userPhotos.ts.
export async function seedPhotos(page: Page, activityId: string, count = 2) {
  await page.addInitScript(
    ([id, n, png]) => {
      const store = {
        [id as string]: Array.from({ length: n as number }, () => png as string),
      };
      localStorage.setItem(
        'fogandfrontier.userPhotos.v1',
        JSON.stringify(store),
      );
    },
    [activityId, count, BLANK_PNG_DATA_URL],
  );
}

// Fails the test if anything in the page extends past the viewport on the x
// axis — the cheapest reliable way to catch the "filter pill row makes the
// whole page scroll sideways at 390px" class of mobile regression.
export async function assertNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'no element should extend past viewport width').toBe(
    innerWidth,
  );
}
