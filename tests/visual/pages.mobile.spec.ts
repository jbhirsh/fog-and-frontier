import { test, expect } from '@playwright/test';
import {
  mockApis,
  waitForVisualReady,
  seedPhotos,
  assertNoHorizontalOverflow,
} from './helpers';

// Mobile visual sweep at 390x844 (iPhone 14). Each snapshot targets a specific
// Phase B regression risk — filter wrapping, hero scaling, the dvh fix, dialog
// touch targets, form stacking, the LocationPicker map, and the Leaflet popup
// link tap area. Runs only under the `mobile` project — see playwright.config.

const COMPLETED_FIXTURE_ID = 'fixture-completed-scenic';

// Deterministic stub for the Gemini-backed /api/generate-activity endpoint so
// the AddActivity review step has stable copy + a fixed pin location.
const STUB_GENERATED = {
  name: 'Test Generated Adventure',
  shortDescription: 'A deterministic stub for the review step screenshot.',
  longDescription:
    'A longer description used to populate the review form. This is fixture text — nothing about it depends on the network.',
  category: 'hiking' as const,
  region: 'peninsula' as const,
  city: 'Half Moon Bay',
  lat: 37.4636,
  lng: -122.4286,
  duration: 'Half Day' as const,
  durationDetail: '3-4 hours',
  difficulty: 'moderate' as const,
  dogFriendly: true,
  hikeDistanceMiles: 4.2,
  hikeElevationFeet: 850,
  notes: 'Stubbed notes for visual fixture.',
  coverImage:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
};

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

  test('adventures list', async ({ page }) => {
    await page.goto('/adventures');
    await waitForVisualReady(page);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('adventures-mobile.png', {
      fullPage: true,
    });
  });

  test('explore empty state', async ({ page }) => {
    await page.goto('/explore');
    await waitForVisualReady(page);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('explore-empty-mobile.png', {
      fullPage: true,
    });
  });

  test('map page (dvh fix)', async ({ page }) => {
    await page.goto('/map');
    await waitForVisualReady(page);
    // Leaflet renders its tile layer asynchronously — wait for the container
    // to mount (the new flex layout keeps it briefly "hidden" by Playwright's
    // heuristic before layout settles, so wait for attached + give tiles a
    // moment to fade in).
    await page.locator('.leaflet-container').waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('map-mobile.png', { fullPage: true });
  });

  test('map popup', async ({ page }) => {
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
    await page
      .getByRole('button', { name: /Deliberately Long Activity Name/ })
      .click();
    await page.getByRole('dialog').waitFor();
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('activity-detail-mobile.png', {
      fullPage: true,
    });
  });

  test('activity detail — your photos section', async ({ page }) => {
    // Pre-seed user photos for the completed-scenic fixture so the
    // "Your Photos" section has real thumbnails on first render.
    await seedPhotos(page, COMPLETED_FIXTURE_ID, 2);
    await page.goto('/adventures');
    await waitForVisualReady(page);
    await page
      .getByRole('button', { name: /Completed Scenic Drive/ })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await waitForVisualReady(page);
    // Scroll the photos heading into view so the snapshot frames it.
    await page
      .getByRole('heading', { name: 'Your Photos' })
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('activity-detail-photos-mobile.png', {
      fullPage: false,
    });
  });

  test('add activity — form step', async ({ page }) => {
    // The Add button is owner-gated. Flip the dev/test-only override before
    // the page boots so useOwner() returns isOwner=true under Playwright.
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ =
        true;
    });
    await page.goto('/');
    await waitForVisualReady(page);
    await page.getByRole('button', { name: /Add activity/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Add activity' });
    await dialog.waitFor();
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('add-activity-form-mobile.png', {
      fullPage: true,
    });
  });

  test('add activity — review step', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ =
        true;
    });
    await page.route('**/api/generate-activity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(STUB_GENERATED),
      });
    });
    await page.goto('/');
    await waitForVisualReady(page);
    await page.getByRole('button', { name: /Add activity/ }).click();
    await page.getByRole('dialog', { name: 'Add activity' }).waitFor();
    await page.getByLabel('Title').fill('Test Adventure');
    await page.getByRole('button', { name: /Generate/ }).click();
    // Header changes to "Review & save" once the stub resolves.
    await page
      .getByRole('heading', { name: 'Review & save' })
      .waitFor();
    await page.locator('.leaflet-container').waitFor();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('add-activity-review-mobile.png', {
      fullPage: true,
    });
  });
});
