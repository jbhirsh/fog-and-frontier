import { test, expect, type Page } from '@playwright/test';
import { fixtureActivities, fixtureCompleted } from './fixtures';

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
