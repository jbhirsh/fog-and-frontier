import { expect, type Page } from '@playwright/test';
import { fixtureActivities, fixtureCompleted } from './fixtures';
import type { Activity } from '../../src/data/types';

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

export async function mockApis(page: Page) {
  // The client now talks to the single GraphQL endpoint — route by operationName
  // (the old per-route REST mocks are gone with the 11 handlers).
  await page.route('**/api/graphql', async (route) => {
    const op = (
      route.request().postDataJSON() as { operationName?: string } | null
    )?.operationName;
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
      case 'TripsList':
        data = { trips: [] };
        break;
      case 'UsersList':
        data = { users: [] };
        break;
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
