// Google's button in the sign-in card on production (#319): Google's
// own button drew itself, then (for a browser signed in to Google) swapped
// itself for a personalized one, a flash; the card now draws its own. The
// card opens, closes and opens again. Google's button drew only on
// production, with One Tap's client, so record as production does (a
// stand-in client: Google draws its button for it all the same):
//
//   VITE_VERCEL_ENV=production \
//     VITE_GOOGLE_ONE_TAP_CLIENT_ID=123-test.apps.googleusercontent.com \
//     VITE_APPLE_CLIENT_ID=app.fogandfrontier.web \
//     npm run gif -- scripts/gif-scenarios/sign-in-google.ts --dir <PR>
//
// Production's catalog, signed out.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';

const scenario: Scenario = {
  name: 'sign-in-google',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: null }));
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(500);
    for (let time = 0; time < 2; time += 1) {
      await gif.click(page, page.getByRole('button', { name: 'Sign in', exact: true }), {
        ms: 600,
      });
      await page.waitForTimeout(2200);
      const card = page.getByRole('dialog', { name: 'Sign in' });
      await gif.click(page, card.getByRole('button', { name: 'Close' }), { ms: 600 });
      await page.waitForTimeout(900);
    }
  },
};

export default scenario;
