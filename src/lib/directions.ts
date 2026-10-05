/**
 * "Get directions" links (#87). Apple platforms open Apple Maps; everything
 * else falls back to Google Maps in the browser. Only the destination is
 * passed, so the maps app routes from the device's current location.
 *
 * No place-name label is sent: Apple's `q` parameter is a search query, so
 * adding it beside `daddr` can make Maps search for the name instead of
 * routing to the exact coordinates, and Google's directions URL has no label
 * parameter for a coordinate destination.
 */

export interface Coords {
  lat?: number | null;
  lng?: number | null;
}

/** The parts of `navigator` that say which platform the browser runs on. */
export interface PlatformHints {
  userAgent?: string;
  platform?: string;
  userAgentData?: { platform?: string };
}

// iPadOS 13+ Safari reports a desktop Mac user agent, which 'mac' covers.
// Matched case-insensitively against the user agent, `navigator.platform`
// ('iPhone', 'MacIntel') and the client-hints platform ('macOS').
const APPLE_TOKENS = ['iphone', 'ipad', 'ipod', 'mac'];

const APPLE_MAPS = 'https://maps.apple.com/';
const GOOGLE_MAPS_DIR = 'https://www.google.com/maps/dir/';

/** Whether the browser runs on an Apple platform (iOS, iPadOS or macOS). */
export function isApplePlatform(hints: PlatformHints = navigator): boolean {
  const text = [hints.userAgentData?.platform, hints.platform, hints.userAgent]
    .join(' ')
    .toLowerCase();
  return APPLE_TOKENS.some((token) => text.includes(token));
}

/**
 * Directions URL to `coords`, or null when the coordinates are missing or not
 * a real place (non-finite, or outside the valid latitude/longitude range).
 */
export function directionsUrl(
  coords: Coords | null | undefined,
  apple: boolean,
): string | null {
  const lat = coords?.lat;
  const lng = coords?.lng;
  if (!isCoordinate(lat, 90) || !isCoordinate(lng, 180)) return null;
  const destination = `${lat},${lng}`;
  if (apple) {
    return `${APPLE_MAPS}?${new URLSearchParams({ daddr: destination })}`;
  }
  return `${GOOGLE_MAPS_DIR}?${new URLSearchParams({ api: '1', destination })}`;
}

function isCoordinate(
  value: number | null | undefined,
  limit: number,
): value is number {
  return Number.isFinite(value) && Math.abs(value as number) <= limit;
}
