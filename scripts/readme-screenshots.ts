// Takes the README's screenshots (docs/screenshots/) for readme-screenshots.yml,
// which runs it after a UI change merges:
//
//   node --experimental-strip-types scripts/readme-screenshots.ts capture <out dir>
//
// capture builds this checkout as scripts/pr-gif-cli.ts builds "after": a
// local production build in the test mode (for the owner flag Explore
// needs), served by `vite preview`, reading production's catalog over the
// visual tests' stub (liveSite) and production's photos through its image
// CDN (cachePhotos). Each shot in SHOTS is taken at the size of the file it
// replaces and written to <out dir> under that file's name. A photo that
// fails to load stops it before anything is written: a README with blank
// covers is worse than an old one. Which shots differ enough from the
// README's to replace them, and the bot PR, are jbhirsh/ci's
// (readme-screenshots/compare and the publish action).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { Page } from '@playwright/test';
import { build, serve, stopServers } from './pr-gif-cli.ts';
import { PRODUCTION, cachePhotos, describeFailed, liveSite, waitForPhotos } from './pr-gif.ts';

export const SHOTS_DIR = 'docs/screenshots';

export interface Shot {
  /** Its file in docs/screenshots/, the name the README links. */
  file: string;
  viewport: { width: number; height: number };
  /** Device pixels per CSS pixel. */
  scale: number;
  path: string;
  /** Explore is owner-only (#111): set the test build's owner flag. */
  owner?: boolean;
  /** Waits for (or opens) what the shot shows, once the page has loaded. */
  ready(page: Page): Promise<void>;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 664 };

async function cards(page: Page) {
  await page.locator('[data-activity-id]').first().waitFor();
}

async function map(page: Page) {
  await page.locator('.leaflet-container').first().waitFor();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  // Tiles fade in, and the pins land after the markers' layout.
  await page.waitForTimeout(1500);
}

/** What the README shows, at the sizes its files have. */
export const SHOTS: readonly Shot[] = [
  {
    file: 'home-split.png',
    viewport: DESKTOP,
    scale: 2,
    path: '/?view=split',
    async ready(page) {
      await cards(page);
      await map(page);
    },
  },
  { file: 'map.png', viewport: DESKTOP, scale: 2, path: '/?view=map', ready: map },
  {
    file: 'activity-detail.png',
    viewport: DESKTOP,
    scale: 2,
    path: '/?view=split',
    async ready(page) {
      await cards(page);
      await map(page);
      await page.locator('[data-activity-id]').first().click();
      await page.getByRole('dialog').waitFor();
      // The dialog's open transition.
      await page.waitForTimeout(500);
    },
  },
  {
    file: 'explore.png',
    viewport: DESKTOP,
    scale: 2,
    path: '/explore',
    owner: true,
    async ready(page) {
      await page.getByRole('heading', { name: 'Explore' }).waitFor();
    },
  },
  { file: 'mobile-list.png', viewport: MOBILE, scale: 3, path: '/?view=list', ready: cards },
  { file: 'mobile-map.png', viewport: MOBILE, scale: 3, path: '/?view=map', ready: map },
];

async function take(shot: Shot, url: string): Promise<Buffer> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({
    executablePath: process.env.PR_GIF_CHROMIUM || undefined,
  });
  try {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: shot.scale,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const { runnerImport } = await import('vite');
    const { module: helpers } = await runnerImport<typeof import('../tests/visual/helpers')>(
      resolve('tests/visual/helpers.ts'),
    );
    await helpers.mockApis(page);
    if (shot.owner) {
      await page.addInitScript(() => {
        (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ = true;
      });
    }
    // After the stub, so production's reads come first; photos last of all.
    await liveSite(page);
    const photos = await cachePhotos(page, { production: PRODUCTION });
    await page.goto(url + shot.path);
    await page.evaluate(() => document.fonts.ready);
    await shot.ready(page);
    await waitForPhotos(page);
    if (photos.failed.size) {
      throw new Error(
        `readme-screenshots: photos didn't load for ${shot.file}: ${describeFailed(photos.failed)}`,
      );
    }
    return await page.screenshot({ animations: 'disabled', caret: 'hide' });
  } finally {
    await browser.close();
  }
}

export async function capture(out: string, root = process.cwd()): Promise<string[]> {
  const work = mkdtempSync(join(tmpdir(), 'readme-screenshots-'));
  const servers: ChildProcess[] = [];
  try {
    const dist = join(work, 'dist');
    build(root, root, dist, 'test');
    const url = await serve(root, root, dist, servers);
    // Every shot first, so one that fails writes nothing.
    const taken = new Map<string, Buffer>();
    for (const shot of SHOTS) taken.set(shot.file, await take(shot, url));
    mkdirSync(out, { recursive: true });
    for (const [file, png] of taken) writeFileSync(join(out, file), png);
    return [...taken.keys()];
  } finally {
    await stopServers(servers);
    rmSync(work, { recursive: true, force: true });
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const [command, out] = argv;
  if (command !== 'capture' || !out) {
    throw new Error('usage: readme-screenshots.ts capture <out dir>');
  }
  const taken = await capture(resolve(out));
  console.error(`readme-screenshots: took ${taken.length} into ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
