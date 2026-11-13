// What the sign-in card and the account menu need to show their passkey
// buttons wherever a GIF records. It sits beside gif-setup.ts, not in
// gif-scenarios/, because jbhirsh/ci's gif tool takes every module directly
// in that folder for a scenario: a PR that changed a helper there would have
// the tool record it and fail.
import type { Page } from '@playwright/test';

/**
 * Gives the page a PublicKeyCredential if its browser has none, so
 * passkeysSupported() (src/lib/passkeys.ts) is true and the sign-in card and
 * account menu show their passkey buttons wherever this records. Nothing here
 * runs a passkey: the scenarios stub the auth routes a click would reach.
 */
export async function withPasskeys(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof window.PublicKeyCredential !== 'function') {
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: class PublicKeyCredential {},
        configurable: true,
      });
    }
  });
}
