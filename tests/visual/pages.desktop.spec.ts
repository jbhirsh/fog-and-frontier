import { test, expect } from '@playwright/test';
import { mockApis, waitForVisualReady } from './helpers';

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
    await expect(page).toHaveScreenshot('curated.png', { fullPage: true });
  });

  test('adventures list', async ({ page }) => {
    await page.goto('/adventures');
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('adventures.png', { fullPage: true });
  });

  test('explore empty state', async ({ page }) => {
    await page.goto('/explore');
    await waitForVisualReady(page);
    await expect(page).toHaveScreenshot('explore-empty.png', {
      fullPage: true,
    });
  });
});
