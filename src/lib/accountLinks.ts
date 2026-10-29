// Connecting Google or Apple to the signed-in account (Better Auth's
// linkSocial): the browser goes to Google or Apple and comes back to the
// page it left, marked with how it went, so the account menu can open and
// say. Better Auth adds its own `error` code to a failure's address.

export type LinkProvider = 'google' | 'apple';

export const PROVIDER_NAMES: Record<LinkProvider, string> = { google: 'Google', apple: 'Apple' };

/** Where a linking comes back to: `href`, marked with its provider and outcome. */
export function linkReturnURL(
  href: string,
  provider: LinkProvider,
  outcome: 'linked' | 'link-failed',
): string {
  const url = new URL(href);
  url.searchParams.set('account', outcome);
  url.searchParams.set('provider', provider);
  return url.toString();
}

export type LinkResult = { provider: LinkProvider; linked: boolean; error: string | null };

/** How a linking that came back to this page went, from its query, or null. */
export function linkResult(search: string): LinkResult | null {
  const params = new URLSearchParams(search);
  const provider = params.get('provider');
  if (provider !== 'google' && provider !== 'apple') return null;
  const outcome = params.get('account');
  if (outcome === 'linked') return { provider, linked: true, error: null };
  if (outcome === 'link-failed') return { provider, linked: false, error: params.get('error') };
  return null;
}

/** The query without a linking's marks, nor Better Auth's error for it. */
export function withoutLinkResult(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of ['account', 'provider', 'error', 'error_description']) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** What the account menu says of a linking that came back. */
export function linkMessage({ provider, linked, error }: LinkResult): string {
  const name = PROVIDER_NAMES[provider];
  if (linked) return `${name} is connected. You can sign in with it now.`;
  if (error === 'account_already_linked_to_different_user') {
    return `That ${name} account already has its own account here, so it can’t be connected to this one.`;
  }
  return `${name} couldn’t be connected. Try again.`;
}
