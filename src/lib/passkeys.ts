/** Whether this browser can use a passkey (Face ID, Touch ID, a security key). */
export function passkeysSupported(): boolean {
  return typeof window.PublicKeyCredential === 'function';
}

/**
 * What to call a passkey made on this device, from its user agent: the
 * account menu lists passkeys by it. An iPad asking for the desktop site
 * says it's a Mac, so a touch screen marks it.
 */
export function deviceName(userAgent: string, maxTouchPoints = 0): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'Mac';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/CrOS/.test(userAgent)) return 'Chromebook';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'This device';
}

/**
 * What to say when adding a passkey failed, from the error Better Auth's
 * passkey client gives (its code is the WebAuthn error's).
 */
export function passkeyAddError({ code }: { code?: string; message?: string }): string {
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'This device already has a passkey for your account, so there’s nothing to add.';
  }
  // A dismissed Face ID or Touch ID sheet is the browser's NotAllowedError,
  // which SimpleWebAuthn passes through under this code (as it does a
  // timeout); an abort is a ceremony another one replaced.
  if (code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' || code === 'ERROR_CEREMONY_ABORTED') {
    return 'Adding the passkey was cancelled or timed out.';
  }
  return 'No passkey was added. Try again.';
}
