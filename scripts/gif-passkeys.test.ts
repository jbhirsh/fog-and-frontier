import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { passkeysSupported } from '../src/lib/passkeys';
import { withPasskeys } from './gif-passkeys';

/** The function withPasskeys has the page run before its scripts do. */
async function initScript(): Promise<() => void> {
  const addInitScript = vi.fn<(script: () => void) => Promise<void>>(() => Promise.resolve());
  await withPasskeys({ addInitScript } as unknown as Page);
  expect(addInitScript).toHaveBeenCalledOnce();
  return addInitScript.mock.calls[0][0];
}

afterEach(() => {
  Reflect.deleteProperty(window, 'PublicKeyCredential');
});

describe('withPasskeys', () => {
  it('gives a browser with no PublicKeyCredential one, so passkeys count as supported', async () => {
    const script = await initScript();
    expect(passkeysSupported()).toBe(false);
    script();
    expect(passkeysSupported()).toBe(true);
    expect(() => new window.PublicKeyCredential()).not.toThrow();
    // Configurable, so a page that defines its own later isn't refused.
    expect(Object.getOwnPropertyDescriptor(window, 'PublicKeyCredential')?.configurable).toBe(true);
  });

  it("leaves a browser's own PublicKeyCredential alone", async () => {
    class Own {}
    Object.defineProperty(window, 'PublicKeyCredential', { value: Own, configurable: true });
    (await initScript())();
    expect(window.PublicKeyCredential).toBe(Own);
  });
});
