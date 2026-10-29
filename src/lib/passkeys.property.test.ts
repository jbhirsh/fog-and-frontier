import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { deviceName } from './passkeys';

// A browser hands over any user agent, a spoofed or empty one included:
// whatever it is, a passkey gets one of the names the account menu shows.

const NAMES = ['iPhone', 'iPad', 'Mac', 'Android', 'Windows', 'Chromebook', 'Linux', 'This device'];

describe('deviceName', () => {
  it('is always one of the device names', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.nat({ max: 10 }), (ua, touch) => {
        expect(NAMES).toContain(deviceName(ua, touch));
      }),
    );
  });
});
