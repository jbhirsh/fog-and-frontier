import { test, expect } from '@playwright/test';
import {
  TRIP_VIEWS,
  mockApis,
  settleTripView,
  signIn,
  waitForVisualReady,
} from './helpers';

// Desktop visual sweep — runs only under the `desktop` project (1280x800).
// Mobile coverage lives in pages.mobile.spec.ts; each project's testMatch in
// playwright.config.ts keeps the right spec on the right viewport.

test.describe('visual regression — desktop', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
  });

  test('home / curated list', async ({ page }) => {
    await page.goto('/');
    await waitForVisualReady(page);
    // On desktop the home view defaults to Split (#93), which mounts a Leaflet
    // map alongside the list. Leaflet renders its tiles asynchronously, so wait
    // for the container to attach and let tiles settle before snapshotting —
    // mirrors the mobile map spec.
    await page.locator('.leaflet-container').waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('curated.png', { fullPage: true });
  });

  test('explore empty state', async ({ page }) => {
    // Explore is owner-only (#111): a non-owner is redirected home, so flip
    // the dev/test-only override before boot to snapshot the owner view.
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ =
        true;
    });
    await page.goto('/explore');
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('explore-empty.png', {
      fullPage: true,
    });
  });
});

// Trips views (#59), signed in as the fixture member.
test.describe('visual regression — trips (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await mockApis(page);
  });

  for (const view of TRIP_VIEWS) {
    test(view.name, async ({ page }) => {
      await page.goto(view.path);
      await settleTripView(page, view.map);
      await expect(page).toHaveScreenshot(`${view.name}.png`, { fullPage: true });
    });
  }
});
