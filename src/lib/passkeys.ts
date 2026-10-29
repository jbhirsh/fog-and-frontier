/** Whether this browser can use a passkey (Face ID, Touch ID, a security key). */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}
