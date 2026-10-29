// The account menu, on a phone (#317): signed in, the header's initial opens
// a card with the account's name and email, its sign-in methods (Connect
// Apple), its passkeys (Remove asks first), Add a passkey and Sign out, and
// closes from its close button.
// Sign-in shows only in builds Vercel makes, so record with it turned on:
//
//   VITE_VERCEL_ENV=preview npm run gif -- \
//     scripts/gif-scenarios/account-menu.ts --dir <PR>
//
// (--after-only where main has no account menu to show.)
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

const PASSKEYS = [
  { id: 'p1', name: 'iPhone', createdAt: '2026-10-29T19:50:00.000Z', backedUp: true },
  { id: 'p2', name: 'Windows', createdAt: '2026-10-28T12:00:00.000Z', backedUp: false },
];

const scenario: Scenario = {
  name: 'account-menu',
  ...PHONE,
  async setup(page) {
    await mockApis(page);
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: SESSION }));
    await page.route('**/api/auth/passkey/list-user-passkeys', (route) =>
      route.fulfill({ json: PASSKEYS }),
    );
    // Signed in with Google; Apple not yet connected.
    await page.route('**/api/auth/list-accounts', (route) =>
      route.fulfill({ json: [{ id: 'a1', providerId: 'google', accountId: 'g1' }] }),
    );
  },
  ready: catalogReady,
  async play(page, gif) {
    await page.waitForTimeout(600);
    await gif.click(page, page.getByRole('button', { name: /^Your account/ }), { ms: 700 });
    await page.waitForTimeout(1800);
    const card = page.getByRole('dialog', { name: 'Your account' });
    // Its passkeys (a menu without them, main's before them, skips this).
    const remove = card.getByRole('button', { name: /^Remove iPhone/ });
    if (await remove.isVisible()) {
      await gif.click(page, remove, { ms: 600 });
      await page.waitForTimeout(1000);
      await gif.click(page, card.getByRole('button', { name: 'Keep iPhone' }), { ms: 500 });
      await page.waitForTimeout(700);
    }
    await gif.glide(page, card.getByRole('button', { name: 'Add a passkey' }), 600);
    await page.waitForTimeout(500);
    await gif.glide(page, card.getByRole('button', { name: 'Sign out' }), 500);
    await page.waitForTimeout(700);
    await gif.click(page, card.getByRole('button', { name: 'Close' }), { ms: 700 });
    await page.waitForTimeout(1000);
  },
};

export default scenario;
