// The account menu, on a phone (#317): signed in, the header's initial opens
// a card with the account's name and email, Add a passkey and Sign out, and
// closes from its close button. Like sign-in.ts, the branch alone:
//
//   VITE_VERCEL_ENV=preview npm run gif -- \
//     scripts/gif-scenarios/account-menu.ts --dir <PR> --after-only
//
// Production's catalog, signed in as a stand-in account (its session
// answered here; the catalog read is production's public one).

import { mockApis } from '../../tests/visual/helpers';
import type { Scenario } from '../gif-types.ts';
import { PHONE, catalogReady } from './phone.ts';

const AT = '2026-10-01T00:00:00.000Z';
const SESSION = {
  session: {
    id: 's1',
    token: 't',
    userId: 'u1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: AT,
    updatedAt: AT,
  },
  user: {
    id: 'u1',
    email: 'sam@example.com',
    name: 'Sam',
    emailVerified: true,
    createdAt: AT,
    updatedAt: AT,
  },
};

const scenario: Scenario = {
  name: 'account-menu',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: SESSION }));
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(600);
    await gif.click(page, page.getByRole('button', { name: /^Your account/ }), { ms: 700 });
    await page.waitForTimeout(1800);
    const card = page.getByRole('dialog', { name: 'Your account' });
    await gif.glide(page, card.getByRole('button', { name: 'Add a passkey' }), 600);
    await page.waitForTimeout(500);
    await gif.glide(page, card.getByRole('button', { name: 'Sign out' }), 500);
    await page.waitForTimeout(700);
    await gif.click(page, card.getByRole('button', { name: 'Close' }), { ms: 700 });
    await page.waitForTimeout(1000);
  },
};

export default scenario;
