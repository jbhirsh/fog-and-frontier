// Cover photos through Vercel's image CDN: on a Vercel deployment, an
// activity's photo is asked for at /_vercel/image on our own domain, which
// fetches it from its host once per size, resizes it, converts it to AVIF or
// WebP, and serves it from Vercel's CDN from then on. Visitors (and the PR
// recordings) don't each go to Wikimedia, which hosts most of the catalog's
// photos and throttles a machine that asks too often, and a card loads a
// card-sized image rather than the 1280px original.
//
// Only hosts vercel.json's images.remotePatterns allows go through it, so it
// can't be used as an open image proxy on our quota; any other cover, and
// every cover off a deployment (`vite`, `vercel dev`, `vite preview`, the
// tests), loads from its own URL as before. CdnImage falls back to that URL
// if the CDN fails.

/** The widths the CDN makes: vercel.json's images.sizes. */
export const CDN_WIDTHS = [96, 192, 384, 640, 960, 1280] as const;
/** The quality it's asked for: vercel.json's images.qualities. */
export const CDN_QUALITY = 75;
/**
 * The photo hosts in the catalog, as vercel.json's images.remotePatterns
 * lists them (src/lib/imageCdn.test.ts keeps the two the same).
 */
export const CDN_HOSTS = [
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  'images.unsplash.com',
  'live.staticflickr.com',
  'www.nps.gov',
  'imgc.ssmedia.com',
  'www.gocalaveras.com',
  'hiddenca.com',
] as const;

/**
 * Whether this build is a Vercel deployment, production or a preview, where
 * /_vercel/image exists. `vercel dev` sets VERCEL_ENV too ("development"),
 * but has no image CDN.
 */
export function onVercel(): boolean {
  const env = import.meta.env.VITE_VERCEL_ENV as string | undefined;
  return env === 'production' || env === 'preview';
}

/**
 * Whether `src` may be an <img>'s source: a web address (http or https) or
 * an inline image (`data:image/`). Anything else, such as a `javascript:`
 * URL typed into the cover field, is no photo at all.
 */
export function isWebUrl(src: string): boolean {
  return /^(?:https?:\/\/|data:image\/)/i.test(src);
}

/**
 * `src` as an <img>'s source, or undefined if it may not be one (isWebUrl).
 * Its `"`, `<` and `>` are percent-encoded, as a browser encodes them in a
 * URL anyway, so it can't be read as HTML (what CodeQL's
 * js/xss-through-dom asks of text a form took in, such as the cover field).
 */
export function imageSrc(src: string): string | undefined {
  return isWebUrl(src) ? src.replace(/["<>]/g, (c) => encodeURIComponent(c)) : undefined;
}

/** Whether `src` is a photo the CDN serves: https, on a listed host. */
export function viaCdn(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && (CDN_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/** The CDN's URL for `src` at `width` pixels wide. */
export function cdnUrl(src: string, width: number): string {
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${width}&q=${CDN_QUALITY}`;
}

export interface ImageSources {
  src: string;
  srcSet?: string;
}

/**
 * The sources for a photo: through the CDN, every width for the browser to
 * pick from by the `sizes` it's shown at, where it can be; else the photo's
 * own URL.
 */
export function imageSources(src: string, enabled = onVercel()): ImageSources {
  if (!enabled || !viaCdn(src)) return { src };
  return {
    src: cdnUrl(src, 960),
    srcSet: CDN_WIDTHS.map((w) => `${cdnUrl(src, w)} ${w}w`).join(', '),
  };
}
