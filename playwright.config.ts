// Visual regression (npm run test:visual, visual.yml): the desktop pages in
// Desktop Safari and the mobile ones on an iPhone 17 Pro, both WebKit, each
// against its own Linux baselines in tests/visual/*-snapshots/. The baselines
// come from CI, never a laptop, whose fonts render differently: run
// visual-baselines.yml by hand on the branch, which commits them there. Data
// is stubbed: a few fixture photos (tests/visual/photos/), the map tiles the
// fixtures' maps show (tests/visual/tiles/), and nothing else outside
// answered (tests/visual/helpers.ts).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // In CI, JUnit too, for the job summary (jbhirsh/ci's job-summary, in
  // visual.yml): each test named with its project (desktop or mobile), and
  // with its retries, so a test that passed only on a retry shows as flaky
  // in the report (each failed try a <flakyFailure>) rather than as a plain
  // pass.
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        [
          'junit',
          {
            outputFile: 'test-results/junit.xml',
            includeProjectInTestName: true,
            includeRetries: true,
          },
        ],
      ]
    : 'list',
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
    // That gates the dev/test-only overrides — the owner flag in
    // src/lib/useOwner.ts and the signed-in email in src/lib/authShim.ts — on
    // (DEV || MODE === 'test'); production deployments use the default
    // (`production`) mode and the override branches are dead-code-eliminated.
    command: 'npx vite build --mode test && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  // Safari only, as the owner uses (#330): Playwright's own descriptors for
  // Desktop Safari and the iPhone 17 Pro (the iPhone 18 Pro's screen), both
  // WebKit, each against its own Linux baselines. Linux WebKit is Safari's
  // engine, not Apple's build: fonts and safe-area insets still differ from
  // a real iPhone's.
  projects: [
    {
      name: 'desktop',
      testMatch: /pages\.desktop\.spec\.ts/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: /pages\.mobile\.spec\.ts/,
      use: { ...devices['iPhone 17 Pro'] },
    },
  ],
});
