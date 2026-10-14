// Which links an activity may keep. A saved link has to be the real page:
// an http(s) URL, never a Google grounding redirect, and for AllTrails a
// trail page on alltrails.com. Gemini's drafts are held to it, and so are
// suggestions (#73), the first links written by people who aren't owners.

/** Where each link field must point; null means any web page. */
export const LINK_HOSTS: Record<string, RegExp | null> = {
  allTrailsUrl: /^(www\.)?alltrails\.com$/,
  reservationUrl: null,
  menuUrl: null,
};

export function isSavableUrl(value: unknown, host: RegExp | null): boolean {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.hostname === 'vertexaisearch.cloud.google.com') return false;
  if (host === null) return true;
  return host.test(url.hostname) && url.pathname.startsWith('/trail/');
}

/**
 * A suggested activity with only savable links (#73): a bad link field
 * becomes null, a bad cover image none (the category glyph shows instead),
 * and bad gallery images are left out.
 */
export function keepSavableLinks<T extends Record<string, unknown>>(activity: T): T {
  const out: Record<string, unknown> = { ...activity };
  for (const [field, host] of Object.entries(LINK_HOSTS)) {
    if (out[field] != null && !isSavableUrl(out[field], host)) out[field] = null;
  }
  if (!isSavableUrl(out.coverImage, null)) {
    out.coverImage = '';
    out.coverCredit = null;
  }
  if (Array.isArray(out.galleryImages)) {
    out.galleryImages = out.galleryImages.filter((u) => isSavableUrl(u, null));
  }
  return out as T;
}
