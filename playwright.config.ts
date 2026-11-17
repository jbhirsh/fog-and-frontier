// Visual screenshots (npm run test:visual, visual.yml): the desktop pages in
// Desktop Safari and the mobile ones on an iPhone 17 Pro, both WebKit. Every
// run writes them afresh into tests/visual/shots/, which git ignores, and
// compares nothing: jbhirsh/ci's visual review compares a PR's with main's
// (a laptop's differ, for its fonts, so CI's are the ones that count). Data
// is stubbed: a few fixture photos (tests/visual/photos/), the map tiles the
// fixtures' maps show (tests/visual/tiles/), and nothing else outside
// answered (tests/visual/helpers.ts).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries, in CI too: a flaky test is a bug, found and fixed rather
  // than tried again (jbhirsh/ci#58).
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  // In CI, JUnit too, for the job summary (jbhirsh/ci's job-summary, in
  // visual.yml): each test named with its project (desktop or mobile).
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        [
          'junit',
          {
            outputFile: 'test-results/junit.xml',
            includeProjectInTestName: true,
          },
        ],
      ]
    : 'list',
  // Where the screenshots go, for jbhirsh/ci's visual-shots to upload (visual.yml,
  // jbhirsh/ci#64). The names are `{state}-{project}-{platform}`, which visual
  // review's columns pair alike (`visual-review` in .github/ci.json).
  snapshotPathTemplate:
    '{testDir}/shots/{testFilePath}-snapshots/{arg}{-projectName}{-platform}{ext}',
  expect: {
    // 1% pixel diff absorbs font-aliasing flake; real regressions blow past this.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
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
  // WebKit. Linux WebKit is Safari's engine, not Apple's build: fonts and
  // safe-area insets still differ from a real iPhone's.
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
