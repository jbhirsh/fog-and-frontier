// A dog-friendly place's dog rules (#296): a link to the page where the
// place, or the park it's in, says where dogs may go and on what leash. The
// app shows no rule as text; the link carries it. Shared by the API (which
// keeps a drafted link only when it's such a page) and the backfill script,
// which can't import each other.

/**
 * Sites that list or review places rather than run them: a page there is
 * someone's account of the rules, not the place's own. Matched as the
 * host or any subdomain of it.
 */
const LISTING_SITES = [
  'alltrails.com',
  'bringfido.com',
  'facebook.com',
  'google.com',
  'instagram.com',
  'reddit.com',
  'tripadvisor.com',
  'wikipedia.org',
  'yelp.com',
];

/** Whether `hostname` is one of {@link LISTING_SITES}, or under one. */
export function isListingSite(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return LISTING_SITES.some((site) => host === site || host.endsWith(`.${site}`));
}
