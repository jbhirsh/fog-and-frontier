// Keeps the README's screenshots (docs/screenshots/) looking like the app, for
// readme-screenshots.yml, which runs it after a UI change merges and opens a
// PR with whatever it replaced:
//
//   node --experimental-strip-types scripts/readme-screenshots.ts capture
//   node --experimental-strip-types scripts/readme-screenshots.ts pr-body <base sha> <head sha> <file>...
//
// capture builds this checkout as scripts/pr-gif-cli.ts builds "after": a
// local production build in the test mode (for the owner flag Explore
// needs), served by `vite preview`, reading production's catalog over the
// visual tests' stub (liveSite) and production's photos through its image
// CDN (cachePhotos). Each shot in SHOTS is taken at the size of the file it
// replaces, and only written over it when more than CHANGED_RATIO of its
// pixels moved, so map tiles and font hinting that wobble between runs don't
// open a PR. A photo that fails to load stops it before anything is written:
// a README with blank covers is worse than an old one. It prints the files
// it replaced, one per line, and sets the `changed` output to them.
//
// pr-body prints the bot PR's description: each replaced screenshot before
// (at the base commit) and after (at the bot's), linked by SHA.

import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { build, repoFromRemote, serve, stopServers } from './pr-gif-cli.ts';
import { PRODUCTION, cachePhotos, describeFailed, liveSite, waitForPhotos } from './pr-gif.ts';

export const SHOTS_DIR = 'docs/screenshots';

/** Share of pixels that must differ before a screenshot is replaced. */
export const CHANGED_RATIO = 0.005;

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

/**
 * The share of pixels that differ between two PNGs, or 1 when their sizes
 * differ (a different framing is a change however it looks).
 */
export function diffRatio(a: Buffer, b: Buffer): number {
  const before = PNG.sync.read(a);
  const after = PNG.sync.read(b);
  if (before.width !== after.width || before.height !== after.height) return 1;
  const differing = pixelmatch(before.data, after.data, null, before.width, before.height, {
    threshold: 0.1,
  });
  return differing / (before.width * before.height);
}

/** Whether a new shot should replace the file (absent when there's none). */
export function shouldReplace(existing: Buffer | undefined, shot: Buffer): boolean {
  return existing === undefined || diffRatio(existing, shot) > CHANGED_RATIO;
}

/** The bot PR's description: before and after for each replaced file. */
export function prBody({
  repo,
  base,
  head,
  files,
  runUrl,
}: {
  repo: string;
  base: string;
  head: string;
  files: readonly string[];
  runUrl?: string;
}): string {
  const raw = (sha: string, file: string) =>
    `https://raw.githubusercontent.com/${repo}/${sha}/${SHOTS_DIR}/${file}`;
  const lines = [
    `The README's screenshots no longer matched the app at ${base.slice(0, 7)}, so ` +
      'scripts/readme-screenshots.ts retook them from a local production build reading ' +
      `production's catalog${runUrl ? ` (${runUrl})` : ''}. Only screenshots where over ` +
      `${CHANGED_RATIO * 100}% of the pixels changed are replaced.`,
    '',
    '## Visual changes',
    '',
    '| Screenshot | Before | After |',
    '|---|---|---|',
    ...files.map(
      (file) =>
        `| \`${file}\` | <img src="${raw(base, file)}" width="300"> | <img src="${raw(head, file)}" width="300"> |`,
    ),
    '',
    '## Validation',
    '',
    'Pictures only: no code changed. Merges itself once the required checks pass.',
  ];
  return lines.join('\n');
}

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

export async function capture(root = process.cwd()): Promise<string[]> {
  const work = mkdtempSync(join(tmpdir(), 'readme-screenshots-'));
  const servers: ChildProcess[] = [];
  try {
    const dist = join(work, 'dist');
    build(root, root, dist, 'test');
    const url = await serve(root, root, dist, servers);
    // Every shot first, so one that fails leaves every file as it was.
    const taken = new Map<string, Buffer>();
    for (const shot of SHOTS) taken.set(shot.file, await take(shot, url));
    const changed: string[] = [];
    for (const [file, png] of taken) {
      const target = join(root, SHOTS_DIR, file);
      if (shouldReplace(existsSync(target) ? readFileSync(target) : undefined, png)) {
        writeFileSync(target, png);
        changed.push(file);
      }
    }
    return changed;
  } finally {
    await stopServers(servers);
    rmSync(work, { recursive: true, force: true });
  }
}

export async function main(argv: readonly string[], env = process.env): Promise<void> {
  const [command, ...rest] = argv;
  if (command === 'capture') {
    const changed = await capture();
    for (const file of changed) console.log(file);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `changed=${changed.join(' ')}\n`);
    console.error(`readme-screenshots: ${changed.length} of ${SHOTS.length} replaced`);
  } else if (command === 'pr-body') {
    const [base, head, ...files] = rest;
    if (!base || !head || files.length === 0)
      throw new Error('pr-body <base sha> <head sha> <file>...');
    const repo = env.GITHUB_REPOSITORY ?? repoFromRemote(env.REPO_URL ?? '');
    const runUrl = env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;
    console.log(prBody({ repo, base, head, files, runUrl }));
  } else {
    throw new Error(
      'usage: readme-screenshots.ts capture | pr-body <base sha> <head sha> <file>...',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
