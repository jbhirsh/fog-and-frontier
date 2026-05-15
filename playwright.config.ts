import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: {
    // 1% pixel diff absorbs font-aliasing flake; real regressions blow past this.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    // Build in --mode test so import.meta.env.MODE === 'test' in the bundle.
    // That gates the dev/test-only owner override in src/lib/useOwner.ts on
    // (DEV || MODE === 'test'); production deployments use the default
    // (`production`) mode and the override branch is dead-code-eliminated.
    command:
      'npx vite build --mode test && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop',
      testMatch: /pages\.desktop\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: /pages\.mobile\.spec\.ts/,
      use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
    },
  ],
});
