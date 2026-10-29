// Signing in, on a phone (#317): the header's Sign in opens the card (Apple,
// Google, a passkey below an "or"); a passkey that doesn't sign anyone in
// says so and points to Google or Apple; the card closes from its close
// button. Sign-in shows only in builds Vercel makes, and main's was Clerk's
// hosted one, which needs Clerk's key, so this records the branch alone:
//
//   VITE_VERCEL_ENV=preview VITE_APPLE_CLIENT_ID=app.fogandfrontier.web \
//     npm run gif -- scripts/gif-scenarios/sign-in.ts --dir <PR> --after-only
//
// Production's catalog, signed out. The passkey's options are refused here,
// as a browser with no passkey for the site would end, so the error shows
// the same way every time.

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';

const scenario: Scenario = {
  name: 'sign-in',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: null }));
    await page.route('**/api/auth/passkey/**', (route) =>
      route.fulfill({ status: 400, json: { message: 'No passkey' } }),
    );
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(600);
    await gif.click(page, page.getByRole('button', { name: 'Sign in', exact: true }), { ms: 700 });
    await page.waitForTimeout(1400);
    const card = page.getByRole('dialog', { name: 'Sign in' });
    await gif.glide(page, card.getByRole('button', { name: 'Continue with Apple' }), 600);
    await page.waitForTimeout(500);
    await gif.glide(page, card.getByRole('button', { name: 'Continue with Google' }), 500);
    await page.waitForTimeout(500);
    await gif.click(page, card.getByRole('button', { name: /Sign in with a passkey/ }), {
      ms: 600,
    });
    await card.getByRole('alert').waitFor();
    await page.waitForTimeout(1800);
    await gif.click(page, card.getByRole('button', { name: 'Close' }), { ms: 700 });
    await page.waitForTimeout(1000);
  },
};

export default scenario;
