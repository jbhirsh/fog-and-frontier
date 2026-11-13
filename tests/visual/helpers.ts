import { existsSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import {
  PHOTO_HOST,
  FIXTURE_EMAIL,
  fixturePhoto,
  FIXTURE_TRIP_CREATED_AT,
  fixtureActivities,
  fixtureCompleted,
  fixtureTripMembers,
  fixtureTrips,
  type FixtureTrip,
} from './fixtures';
import type { Activity } from '../../src/data/types';
import { distanceMiles } from '../../src/data/home';
import { osmTileUrl, tileOf } from '../../scripts/osm-tiles.ts';

// 1x1 transparent PNG, for every outside image but the fixture photos and
// map tiles, so screenshots don't depend on the network.
const BLANK_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

// Owner photos (#19) by page: how many each activity has. `seedPhotos` fills
// it, and the mocked `activityPhotos` read serves it, from the fixture
// photos (tests/visual/fixtures.ts).
const photoSeeds = new WeakMap<Page, Record<string, number>>();

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
    costTier: a.costTier ?? null,
    hours: a.hours ?? null,
    reservationUrl: a.reservationUrl ?? null,
    menuUrl: a.menuUrl ?? null,
    sourceUrl: a.sourceUrl ?? null,
    dogRulesUrl: a.dogRulesUrl ?? null,
    cardLine: a.cardLine ?? null,
    cardName: a.cardName ?? null,
    dietary: a.dietary ?? null,
    completed: a.completed ?? null,
    completedDate: a.completedDate ?? null,
    notes: a.notes ?? null,
    contributors: a.contributors ?? null,
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

export function toTripRow(t: FixtureTrip) {
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
      snapshot: {
        ...toActivityRow(fixtureActivities[a.activityId]),
        __typename: 'ActivitySnapshot',
      },
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
// `ready` is text that only appears once the view's mocked data has rendered,
// so a slow runner can't snapshot a loading state.
export const TRIP_VIEWS = [
  { name: 'trips-list', path: '/trips', ready: 'Spring Getaway' },
  { name: 'trips-new', path: '/trips/new', ready: 'Open voting first' },
  // A trip opens on its plan, the map behind its Map tab (#294).
  { name: 'trip-planning', path: '/trips/fixture-trip-planning', ready: 'Coast Weekend' },
  { name: 'trip-voting', path: '/trips/fixture-trip-voting', ready: 'Spring Getaway' },
] as const;

export async function settleTripView(page: Page, view: { ready: string }) {
  await expect(page.getByText(view.ready).first()).toBeVisible();
  await waitForVisualReady(page);
}

// The map tiles the fixtures' maps show (#338): OpenStreetMap's, at
// tests/visual/tiles/z/x/y.png (its README says where they come from).
const TILES = new URL('./tiles/', import.meta.url);

/**
 * Stubs everything the app asks the network for. `refuseOffsite`, which the
 * visual specs pass, aborts any outside request the stub doesn't answer, for
 * expectNoOffsiteRequests to fail on; without it such a request goes through,
 * as the PR GIFs and README screenshots need (One Tap's script from
 * accounts.google.com, for one).
 */
export async function mockApis(page: Page, { refuseOffsite = false } = {}) {
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
      variables?: { lat?: number; lng?: number; id?: string; activityId?: string };
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
      case 'ActivityPhotos': {
        const activityId = body?.variables?.activityId ?? '';
        const count = photoSeeds.get(page)?.[activityId] ?? 0;
        data = {
          activityPhotos: Array.from({ length: count }, (_, i) => ({
            __typename: 'ActivityPhoto',
            id: `${activityId}-photo-${i + 1}`,
            activityId,
            url: fixturePhoto(`owner${(i % 2) + 1}.webp`),
            createdAt: '2026-10-01T00:00:00.000Z',
          })),
        };
        break;
      }
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
      case 'PendingSuggestions':
        // No suggestions waiting (#73): the owners' review queue renders
        // nothing, so the owner baselines stay unchanged.
        data = { pendingSuggestions: [] };
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
  // The fixture photos come from tests/visual/photos/ and the map tiles from
  // tests/visual/tiles/; any other outside image is a 1x1 PNG, so the page
  // reaches a stable state whatever the network does. With refuseOffsite
  // nothing else leaves the machine: it's refused, and noted for
  // expectNoOffsiteRequests, which the specs call after each test (the fonts
  // and icons are the build's own, so nothing should ask), as is a tile not
  // committed. The PR GIFs' scenarios use this stub too, under
  // scripts/live-site.ts's routes, which take production's data, photos and
  // tiles before a request gets here.
  const offsite: string[] = [];
  if (refuseOffsite) offsiteRequests.set(page, offsite);
  await page.route(/^https?:\/\/(?!localhost)/i, async (route) => {
    const url = new URL(route.request().url());
    const tile = tileOf(url.href);
    if (tile) {
      const file = new URL(`${tile}.png`, TILES);
      if (existsSync(file)) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(file) });
        return;
      }
      if (refuseOffsite) {
        offsite.push(
          `${url.href}: map tile ${tile} isn't in tests/visual/tiles. Save ${osmTileUrl(tile)} as tests/visual/tiles/${tile}.png and commit it with the change (tests/visual/tiles/README.md)`,
        );
        await route.abort();
        return;
      }
    }
    if (url.hostname === PHOTO_HOST) {
      const file = new URL(`./photos/${url.pathname.slice(1)}`, import.meta.url);
      const known = /^\/[a-z0-9]+\.webp$/.test(url.pathname) && existsSync(file);
      await (known
        ? route.fulfill({ status: 200, contentType: 'image/webp', body: readFileSync(file) })
        : route.fulfill({ status: 404 }));
      return;
    }
    if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(url.pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: BLANK_PNG_BYTES,
      });
      return;
    }
    if (!refuseOffsite) {
      await route.continue();
      return;
    }
    offsite.push(url.href);
    await route.abort();
  });
}

// The outside requests mockApis refused, by page.
const offsiteRequests = new WeakMap<Page, readonly string[]>();

/**
 * Fails the test if the page asked for anything outside that the stub doesn't
 * answer, a map tile not committed included, or if the page's stub wasn't set
 * to refuse such requests (mockApis(page, { refuseOffsite: true })).
 */
export function expectNoOffsiteRequests(page: Page) {
  const refused = offsiteRequests.get(page);
  expect(refused, 'mockApis(page, { refuseOffsite: true }) before the test').toBeDefined();
  expect(refused, 'outside requests the stub refused').toEqual([]);
}

/**
 * Waits until the page looks as a visitor would see it once it has loaded:
 * the text faces in, and every photo that would be on screen loaded and
 * decoded. It scrolls through the page and back first, so lazy covers below
 * the fold load as they would for a visitor (leaving `loading` as it is,
 * which a lazy-loading regression would show in). A photo that didn't load
 * fails the test, rather than passing as a blank.
 */
export async function waitForVisualReady(page: Page) {
  const broken = await page.evaluate(async () => {
    const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
    // The lazy ones that come into view, past any scroll box's clipping,
    // including any the scroll itself mounts (a list's next page, say).
    const seen = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) seen.add(entry.target);
    });
    const observe = () => {
      for (const img of document.images) observer.observe(img);
    };
    const top = scrollY;
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
      scrollTo(0, y);
      observe();
      await frame();
      await frame();
    }
    scrollTo(0, top);
    observe();
    await frame();
    await frame();
    observer.disconnect();
    const due = [...document.images].filter((img) => img.loading !== 'lazy' || seen.has(img));
    await Promise.all(due.map((img) => img.decode().catch(() => undefined)));
    await Promise.all(
      ['Inter Variable', 'Hanken Grotesk Variable'].map((face) =>
        document.fonts.load(`16px "${face}"`),
      ),
    );
    await document.fonts.ready;
    return due.filter((img) => img.naturalWidth === 0).map((img) => img.currentSrc || img.src);
  });
  expect(broken, "photos that didn't load").toEqual([]);
  // Let layout settle after the scroll back.
  await page.waitForTimeout(200);
}

// Gives an activity owner photos (#19), served by mockApis' `activityPhotos`.
// Owner-only, so pair it with signIn.
export function seedPhotos(page: Page, activityId: string, count = 2) {
  photoSeeds.set(page, { ...photoSeeds.get(page), [activityId]: count });
}

// Fails the test if anything in the page extends past the viewport on the x
// axis — the cheapest reliable way to catch the "filter pill row makes the
// whole page scroll sideways at 402px" class of mobile regression.
export async function assertNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'no element should extend past viewport width').toBe(innerWidth);
}

// Deterministic stub for the Gemini-backed `generateActivity` GraphQL mutation
// so the AddActivity review step has stable copy + a fixed pin location. Shaped
// as the `GeneratedActivity` row the client reads — every selected field is
// present (nulls for the ones this fixture doesn't exercise) plus the
// __typenames Apollo adds to the mutation selection.
const STUB_GENERATED = {
  __typename: 'GeneratedActivity' as const,
  name: 'Test Generated Adventure',
  shortDescription: 'A deterministic stub for the review step screenshot.',
  longDescription:
    'A longer description used to populate the review form. This is fixture text — nothing about it depends on the network.',
  category: 'hiking' as const,
  region: 'peninsula' as const,
  parkType: null,
  city: 'Half Moon Bay',
  lat: 37.4636,
  lng: -122.4286,
  duration: 'Half Day' as const,
  durationDetail: '3-4 hours',
  difficulty: 'moderate' as const,
  dogFriendly: true,
  hikeDistanceMiles: 4.2,
  hikeElevationFeet: 850,
  cuisine: null,
  priceRange: null,
  costTier: null,
  hours: null,
  reservationUrl: null,
  menuUrl: null,
  dietary: null,
  allTrailsUrl: null,
  notes: 'Stubbed notes for visual fixture.',
  coverImage: fixturePhoto('generated.webp'),
  coverCredit: null,
};

// The client reaches Gemini through the single GraphQL endpoint, so answer
// `GenerateActivity` with the stub and let mockApis' route handle every
// other operation via fallback. Call after mockApis.
export async function stubGenerateActivity(page: Page) {
  await page.route('**/api/graphql', async (route) => {
    const op = (route.request().postDataJSON() as { operationName?: string } | null)?.operationName;
    if (op !== 'GenerateActivity') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generateActivity: {
            __typename: 'GenerateActivityPayload',
            activity: STUB_GENERATED,
          },
        },
      }),
    });
  });
}
