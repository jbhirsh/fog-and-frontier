import { afterEach, describe, expect, it } from 'vitest';
import { deviceName, passkeyAddError, passkeysSupported } from './passkeys';

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

describe('deviceName', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 0, 'iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 5, 'iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5, 'iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0, 'Mac'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 1, 'Mac'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36', 5, 'Android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 0, 'Windows'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36', 0, 'Chromebook'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 0, 'Linux'],
    ['curl/8.0', 0, 'This device'],
  ])('names %s (%i touch points) %s', (ua, touch, name) => {
    expect(deviceName(ua, touch)).toBe(name);
  });
});

describe('passkeyAddError', () => {
  it('says a duplicate is one, a cancel a cancel, and anything else failed', () => {
    expect(passkeyAddError({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' })).toMatch(
      /already has/,
    );
    // A dismissed Face ID sheet (NotAllowedError, passed through), and an abort.
    expect(passkeyAddError({ code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' })).toBe(
      'Adding the passkey was cancelled or timed out.',
    );
    expect(passkeyAddError({ code: 'ERROR_CEREMONY_ABORTED' })).toBe(
      'Adding the passkey was cancelled or timed out.',
    );
    expect(passkeyAddError({ code: 'SOMETHING_ELSE' })).toBe('No passkey was added. Try again.');
    expect(passkeyAddError({})).toBe('No passkey was added. Try again.');
  });
});
