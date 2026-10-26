import { test, expect } from '@playwright/test';
import {
  TRIP_VIEWS,
  mockApis,
  settleTripView,
  signIn,
  waitForVisualReady,
  seedPhotos,
  assertNoHorizontalOverflow,
  stubGenerateActivity,
} from './helpers';

// Mobile visual sweep at 390x844 (iPhone 14). Each snapshot targets a specific
// Phase B regression risk — filter wrapping, hero scaling, the dvh fix, dialog
// touch targets, form stacking, the LocationPicker map, and the Leaflet popup
// link tap area. Runs only under the `mobile` project — see playwright.config.

const COMPLETED_FIXTURE_ID = 'fixture-completed-scenic';

test.describe('visual regression — mobile', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
  });

  test('curated list (filter pill wrap)', async ({ page }) => {
    await page.goto('/');
    await waitForVisualReady(page);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('curated-mobile.png', {
      fullPage: true,
    });
  });

  test('curated list — filters on, as chips under the Filters button', async ({ page }) => {
    await page.goto('/?completed=1');
    await waitForVisualReady(page);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('curated-mobile-filters-on.png', { fullPage: false });
  });

  test('curated list — the Filters sheet', async ({ page }) => {
    await page.goto('/');
    await waitForVisualReady(page);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('dialog', { name: 'Filters' }).waitFor();
    // Past the sheet's rise.
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('curated-mobile-filter-sheet.png', { fullPage: false });
  });

  test('explore empty state', async ({ page }) => {
    // Explore is owner-only (#111): a non-owner is redirected home, so flip
    // the dev/test-only override before boot to snapshot the owner view.
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ = true;
    });
    await page.goto('/explore');
    await waitForVisualReady(page);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('explore-empty-mobile.png', {
      fullPage: true,
    });
  });

  test('map page (full-screen map + list sheet at peek, #96)', async ({ page }) => {
    await page.goto('/map');
    await waitForVisualReady(page);
    // Leaflet renders its tile layer asynchronously — wait for the container
    // to mount (the new flex layout keeps it briefly "hidden" by Playwright's
    // heuristic before layout settles, so wait for attached + give tiles a
    // moment to fade in).
    await page.locator('.leaflet-container').waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    // Viewport, not fullPage: the mobile map is a position:fixed full-screen
    // backdrop with a fixed list sheet over it (#96), which fullPage
    // stitching renders unreliably. The viewport is exactly what the user sees.
    await expect(page).toHaveScreenshot('map-mobile.png', { fullPage: false });
  });

  test('map page — list sheet at half (#96)', async ({ page }) => {
    await page.goto('/map');
    await waitForVisualReady(page);
    await page.locator('.leaflet-container').waitFor({ state: 'attached' });
    // Tap the grabber: peek → half. The pins under the sheet must not paint
    // through it (the map wrapper's `isolation: isolate`).
    await page.getByRole('button', { name: /Resize list/ }).click();
    // Let the 0.3s height transition and the tiles settle.
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('map-sheet-half-mobile.png', {
      fullPage: false,
    });
  });

  // Leaflet marker click doesn't trigger the popup under Playwright on
  // ubuntu-latest — the marker is found and force-clickable, but Leaflet
  // doesn't open the popup (likely the marker's transform-positioned hit
  // target lands outside the click coordinate after force-click bypass).
  // The underlying `min-h-11` tap-area fix shipped in PR #43; coverage here
  // is defensive. Tracked as follow-up; ship the other 8 snapshots.
  test.fixme('map popup', async ({ page }) => {
    await page.goto('/map');
    await waitForVisualReady(page);
    await page.locator('.leaflet-container').waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    // Marker order: 0 = HOME, 1+ = activities. Click the first activity marker
    // so the popup has a "View details" link that we want to verify tap-target
    // sizing for.
    const markers = page.locator('.leaflet-marker-icon');
    // Force-click — Leaflet markers carry the leaflet-zoom-animated class
    // during pan/zoom and Playwright's actionability check fails them as
    // "non-actionable" even though they're clickable HTML buttons.
    await markers.nth(1).click({ force: true });
    await page.locator('.leaflet-popup').waitFor();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('map-popup-mobile.png', {
      fullPage: false,
    });
  });

  test('activity detail dialog', async ({ page }) => {
    await page.goto('/');
    await waitForVisualReady(page);
    // Open the first card (the long-name fixture). Clicking its button-shaped
    // card opens the ActivityDetail dialog.
    await page.getByRole('button', { name: /Deliberately Long Activity Name/ }).click();
    await page.getByRole('dialog').waitFor();
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('activity-detail-mobile.png', {
      fullPage: true,
    });
  });

  // Permalinks (#86): a link straight to an activity (a restaurant, sharing
  // the one route) opens its detail over the catalog.
  test('activity permalink — opened from a link', async ({ page }) => {
    await page.goto('/activity/fixture-short-food');
    await page.getByRole('dialog').waitFor();
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('activity-permalink-mobile.png', {
      fullPage: true,
    });
  });

  test('activity permalink — not found', async ({ page }) => {
    await page.goto('/activity/no-such-activity');
    await page.getByRole('dialog', { name: 'Activity not found' }).waitFor();
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('activity-not-found-mobile.png', {
      fullPage: true,
    });
  });

  test('activity detail — your photos section', async ({ page }) => {
    // Your Photos is owner-only (#19): sign in as the owner, and give the
    // completed-scenic fixture two photos so the section has thumbnails.
    await signIn(page);
    seedPhotos(page, COMPLETED_FIXTURE_ID, 2);
    // The Adventures page is retired (#5); its list is now the catalog's
    // "Completed only" filter.
    await page.goto('/?completed=1');
    await waitForVisualReady(page);
    await page.getByRole('button', { name: /Completed Scenic Drive/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await waitForVisualReady(page);
    // Scroll the photos heading into view so the snapshot frames it, once the
    // photos have loaded.
    await page.getByAltText('Completed Scenic Drive 2').waitFor();
    await page.getByRole('heading', { name: 'Your Photos' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('activity-detail-photos-mobile.png', {
      fullPage: false,
    });
  });

  test('add activity — form step', async ({ page }) => {
    // The Add button is owner-gated. Flip the dev/test-only override before
    // the page boots so useOwner() returns isOwner=true under Playwright.
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ = true;
    });
    await page.goto('/');
    await waitForVisualReady(page);
    // A phone's Add is in its tab bar (#289).
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Add activity' });
    await dialog.waitFor();
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('add-activity-form-mobile.png', {
      fullPage: true,
    });
  });

  test('add activity — review step', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ = true;
    });
    await stubGenerateActivity(page);
    await page.goto('/');
    await waitForVisualReady(page);
    // A phone's Add is in its tab bar (#289).
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    await page.getByRole('dialog', { name: 'Add activity' }).waitFor();
    await page.getByLabel('Title').fill('Test Adventure');
    await page.getByRole('button', { name: /Generate/ }).click();
    // Header changes to "Review & save" once the stub resolves.
    await page.getByRole('heading', { name: 'Review & save' }).waitFor();
    await page.locator('.leaflet-container').waitFor();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('add-activity-review-mobile.png', {
      fullPage: true,
    });
  });
});

// Trips views (#59), signed in as the fixture member.
test.describe('visual regression — trips (mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await mockApis(page);
  });

  for (const view of TRIP_VIEWS) {
    test(view.name, async ({ page }) => {
      await page.goto(view.path);
      await settleTripView(page, view);
      // WebKit fills an empty date field with today's date in grey, read
      // from the system clock (page.clock can't pin it), so the snapshot
      // would change every day. Mask the fields: their size and place
      // are still checked.
      await expect(page).toHaveScreenshot(`${view.name}.png`, {
        fullPage: true,
        mask: [page.locator('input[type="date"]')],
      });
    });
  }
});
