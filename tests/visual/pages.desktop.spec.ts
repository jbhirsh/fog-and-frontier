import { test, expect } from '@playwright/test';
import {
  TRIP_VIEWS,
  mockApis,
  settleTripView,
  signIn,
  stubGenerateActivity,
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

  // Permalinks (#86): a link straight to an activity opens its detail over
  // the catalog.
  test('activity permalink — opened from a link', async ({ page }) => {
    await page.goto('/activity/fixture-short-food');
    await page.getByRole('dialog').waitFor();
    await waitForVisualReady(page);
    await page.locator('.leaflet-container').waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('activity-permalink.png', {
      fullPage: true,
    });
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

  // The Add dialog's title is sticky. Scrolled so the pin map passes under
  // it, the title must stay on top: Leaflet's layers (tiles 200, controls
  // 1000) once painted over it. Not a snapshot: a hit test at the title's
  // bottom edge. Tiles ignore pointer events, which elementFromPoint honours,
  // so the map's layers are made hit-testable; and a tile stays
  // visibility: hidden until it loads, so the test waits for one and checks
  // that a map layer really is under the title before trusting the hit.
  test('add activity — the map scrolls under the dialog title', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 560 });
    await page.addInitScript(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ =
        true;
    });
    await stubGenerateActivity(page);
    await page.goto('/');
    await waitForVisualReady(page);
    await page.getByRole('button', { name: /Add activity/ }).click();
    await page.getByLabel('Title').fill('Test Adventure');
    await page.getByRole('button', { name: /Generate/ }).click();
    await page.getByRole('heading', { name: 'Review & save' }).waitFor();
    const dialog = page.getByRole('dialog', { name: 'Add activity' });
    await dialog.locator('.leaflet-tile-loaded').first().waitFor();
    const result = await dialog.evaluate((d) => {
      const title = d.querySelector('h2')!.parentElement!;
      const map = d.querySelector('.leaflet-container')!;
      const bar = title.getBoundingClientRect();
      d.scrollTop += map.getBoundingClientRect().top - (bar.top + bar.height / 2);
      const style = document.createElement('style');
      style.textContent =
        '.leaflet-container, .leaflet-container * { pointer-events: auto !important; }';
      document.head.append(style);
      const r = title.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.bottom - 6;
      const hit = document.elementFromPoint(x, y);
      title.style.visibility = 'hidden';
      const under = document.elementFromPoint(x, y);
      title.style.visibility = '';
      return {
        mapLayerUnder: !!under?.closest(
          '.leaflet-tile, .leaflet-marker-icon, .leaflet-control',
        ),
        titleOnTop: title.contains(hit),
      };
    });
    expect(result).toEqual({ mapLayerUnder: true, titleOnTop: true });
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
      await settleTripView(page, view);
      await expect(page).toHaveScreenshot(`${view.name}.png`, { fullPage: true });
    });
  }
});
