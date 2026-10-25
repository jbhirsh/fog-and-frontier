// What every PR GIF of this app needs around its scenario (the `gif.setup`
// setting in .github/ci.json; jbhirsh/ci's gif/cli.mjs calls it): pictures
// show the app exactly as production does (scripts/live-site.ts). The
// scenario's own setup stubs the API (tests/visual/helpers.ts's mockApis)
// and signs in through the test flags for screens only a signed-in account
// or an owner sees; over its stub, every read goes to production's API and
// every photo comes through production's image CDN, the map's tiles from
// OpenStreetMap. A photo that fails to load stops the run before anything
// is published (photos that did load are cached for the next try).
//
// Options it adds to the command line:
//   --production <url>      the live site whose API and image CDN the builds
//                           use (https://fog-and-frontier.vercel.app)
//   --allow-missing-photos  publish even if some photos failed to load
import type { Page } from '@playwright/test';
import type { Setup, SetupContext } from './gif-types.ts';
import { PHOTO_CACHE, PRODUCTION, cachePhotos, describeFailed, liveSite } from './live-site.ts';

/** The live site the options name, without a trailing slash. */
export function production(options: SetupContext['options']): string {
  const given = options.production;
  if (given === undefined || given === true || given === false) return PRODUCTION;
  if (!/^https?:\/\/[^/\s]+/.test(given)) throw new Error('--production must be an http(s) URL');
  return given.replace(/\/+$/, '');
}

// The photos each page failed to load, as cachePhotos notes them.
const failures = new WeakMap<Page, ReadonlyMap<string, string>>();

export default {
  options: {
    production: { type: 'string' },
    'allow-missing-photos': { type: 'boolean' },
  },
  // After the scenario's stub, so these routes come first; cachePhotos last,
  // so photos come from the cache before any other route.
  async afterSetup(page, { options }) {
    const live = production(options);
    await liveSite(page, `${live}/api/graphql`);
    failures.set(page, (await cachePhotos(page, { production: live })).failed);
  },
  // Before recording, if the photos in view already failed; and after, for
  // any that failed on the way, as the flow scrolled or opened them.
  check(page, { side, options }) {
    const failed = failures.get(page);
    if (!failed?.size || options['allow-missing-photos'] === true) return Promise.resolve();
    return Promise.reject(
      new Error(
        `pr-gif: ${failed.size} photo${failed.size === 1 ? '' : 's'} didn't load for ${side}: ${describeFailed(failed)}. ` +
          `Nothing was published. Photos that did load are cached in ${PHOTO_CACHE}; try again once the host lets this machine back in, ` +
          'or pass --allow-missing-photos.',
      ),
    );
  },
} satisfies Setup;
