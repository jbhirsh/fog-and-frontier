import { afterEach, describe, expect, it } from 'vitest';
import { passkeysSupported } from './passkeys';

type PasskeyWindow = { PublicKeyCredential?: unknown };

afterEach(() => {
  delete (window as PasskeyWindow).PublicKeyCredential;
});

describe('passkeysSupported', () => {
  it('is whether the browser has WebAuthn', () => {
    expect(passkeysSupported()).toBe(false);
    (window as PasskeyWindow).PublicKeyCredential = function PublicKeyCredential() {};
    expect(passkeysSupported()).toBe(true);
  });

  it('is false for a PublicKeyCredential that is not a constructor', () => {
    (window as PasskeyWindow).PublicKeyCredential = {};
    expect(passkeysSupported()).toBe(false);
  });
});
