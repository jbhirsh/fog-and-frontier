// The mobile map: on main every pin drawn, overlapping along the Bay, and a
// tapped pin opening the full detail; on the branch the pins that would
// overlap grouped into counts (#291), a group's tap flying in to split it,
// and a tapped pin showing its card above the tab bar.
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts scripts/gif-scenarios/map-groups.ts --dir <PR number>
//
// Production's catalog, signed out.

import type { Page } from '@playwright/test';
import { mockApis } from '../../tests/visual/helpers';
import { click, type Scenario } from '../pr-gif.ts';
import { PHONE, catalogReady } from './phone.ts';

type Point = { x: number; y: number };

// The middle of the widest marker matching `selector` in the clear part of
// the map: below the header, above the sheet, away from the zoom buttons.
async function widest(page: Page, selector: string): Promise<Point | null> {
  return page.evaluate((sel) => {
    let best: { x: number; y: number; w: number } | null = null;
    for (const el of document.querySelectorAll(sel)) {
      // Home's house isn't a place.
      if (el.textContent?.includes('home')) continue;
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (y < 140 || y > 600 || x < 30 || x > 330) continue;
      if (!best || r.width > best.w) best = { x, y, w: r.width };
    }
    return best && { x: best.x, y: best.y };
  }, selector);
}

const GROUP = '.pin-group';
const PIN = '.leaflet-marker-icon:not(.pin-group)';

const scenario: Scenario = {
  name: 'map-groups',
  ...PHONE,
  path: '/?view=map',
  async setup(page) {
    await mockApis(page);
  },
  async ready(page) {
    await catalogReady(page);
    await page.locator('.leaflet-marker-icon').nth(5).waitFor();
    await page.waitForTimeout(1500);
  },
  async run(page) {
    await page.waitForTimeout(1500);
    const group = await widest(page, GROUP);
    if (group) {
      await click(page, group, { ms: 800 });
    } else {
      // Main has no groups: zoom in as far, by the + button.
      const zoomIn = page.getByRole('button', { name: 'Zoom in' });
      await click(page, zoomIn, { ms: 800 });
      await page.waitForTimeout(500);
      await click(page, zoomIn, { ms: 300 });
    }
    await page.waitForTimeout(1800);
    const pin = await widest(page, PIN);
    if (pin) await click(page, pin, { ms: 800 });
    await page.waitForTimeout(2200);
  },
};

export default scenario;
