import { test, expect, type Page } from '@playwright/test';
import { fixtureActivities, fixtureCompleted } from './fixtures';

// 1x1 transparent PNG. Returned for every external image so screenshots don't
// depend on the network or on which remote photos happen to load.
const BLANK_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

async function mockApis(page: Page) {
  await page.route('**/api/activities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureActivities),
    });
  });
  await page.route('**/api/completed', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureCompleted),
    });
  });
  await page.route('**/api/discover', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [], sources: [] }),
    });
  });
  // Stub every external image with a 1x1 PNG so the page reaches a stable
  // visual state regardless of remote latency. Without this, lazy-loaded cover
  // images keep mutating the page and `toHaveScreenshot` times out trying to
  // capture two consecutive identical frames.
  await page.route(/^https?:\/\/(?!localhost)/i, async (route) => {
    const url = route.request().url();
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

async function waitForVisualReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Settle any layout from late-loading fonts/icons
  await page.waitForTimeout(200);
}

test.describe('visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
  });

  test('home / curated list', async ({ page }) => {
    await page.goto('/');
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('home.png', { fullPage: true });
  });

  test('adventures list', async ({ page }) => {
    await page.goto('/adventures');
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('adventures.png', { fullPage: true });
  });

  test('explore empty state', async ({ page }) => {
    await page.goto('/explore');
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('explore-empty.png', { fullPage: true });
  });
});
