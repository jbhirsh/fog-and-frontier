// Condition waits for a page in Playwright, shared by the visual tests
// (tests/visual/), the README screenshots and the PR GIF scenarios: each
// returns once the page is in the state it names, never after a guessed
// duration (jbhirsh/ci#58), and fails at Playwright's own limit if the page
// never gets there. Each check runs in the page, so it is a function of its
// own, exported for the tests to run against a DOM.
import type { Page } from '@playwright/test';

/**
 * In the page: whether every Leaflet tile has finished, loaded or failed, and
 * faded in. Leaflet fades a tile in with script over 200 ms, which a
 * screenshot's `animations: 'disabled'` doesn't stop. A failed tile counts as
 * finished, so the caller's own check (a tile not committed, a refused one)
 * names it rather than this wait running out.
 */
export function mapTilesShown(): boolean {
  const tiles = [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')];
  return (
    tiles.length > 0 &&
    tiles.every((tile) => tile.complete && getComputedStyle(tile).opacity === '1')
  );
}

/**
 * In the page: whether no CSS animation or transition is still running. One
 * that never ends (a spinner) isn't waited for. Motion driven by script, such
 * as Leaflet's pans, isn't seen.
 */
export function nothingMoving(): boolean {
  return document
    .getAnimations()
    .every(
      (animation) =>
        animation.playState !== 'running' ||
        animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY,
    );
}

/** Waits until the page's Leaflet map shows every tile it asked for. */
export async function waitForMapTiles(page: Pick<Page, 'waitForFunction'>): Promise<void> {
  await page.waitForFunction(mapTilesShown);
}

/** Waits until nothing on the page moves, as once a sheet has risen or a dialog opened. */
export async function waitForStill(page: Pick<Page, 'waitForFunction'>): Promise<void> {
  await page.waitForFunction(nothingMoving);
}
