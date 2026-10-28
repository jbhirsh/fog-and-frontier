// Explore's error, signed in as an owner, when Discover fails: on main its
// message squeezed into an 80px column (`max-w-xl` read the theme's 80px
// spacing, not 36rem); on the branch it wraps at 36rem.
//
//   npm run gif -- scripts/gif-scenarios/explore-error.ts --dir <PR number>

import { mockApis, signIn } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { DESKTOP } from './desktop.ts';

const scenario: Scenario = {
  name: 'explore-error',
  ...DESKTOP,
  path: '/explore',
  async setup(page) {
    await mockApis(page);
    await signIn(page);
    await page.route('**/api/graphql', async (route) => {
      const body = route.request().postDataJSON() as { operationName?: string } | null;
      if (body?.operationName !== 'Discover') return route.fallback();
      await route.fulfill({
        json: {
          data: null,
          errors: [
            {
              message:
                'Gemini took too long to answer. It can be slow to search the web; try again in a minute.',
            },
          ],
        },
      });
    });
  },
  async ready(page, gif) {
    await page.getByRole('button', { name: /Discover events/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await gif.glide(page, { x: 640, y: 500 }, 0);
  },
  async play(page, gif) {
    await page.waitForTimeout(1000);
    await gif.click(page, page.getByRole('button', { name: /Discover events/ }), { ms: 800 });
    await page.getByText('Something went wrong.').waitFor();
    await page.waitForTimeout(800);
    // The message is below the hero.
    await gif.scroll(page, 260, 900);
    await page.waitForTimeout(2500);
  },
};

export default scenario;
