import { useState, type ImgHTMLAttributes } from 'react';
import { imageSources, imageSrc, type ImageSources } from '../lib/imageCdn';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError'> {
  /** The photo's own URL. */
  src: string;
  /** How wide it's shown, for the browser to pick a width (see imageSources). */
  sizes: string;
  /** Called once the photo has failed through the CDN and on its own URL. */
  onFailed?: () => void;
  /** Off Vercel by default (src/lib/imageCdn.ts); the tests turn it on. */
  cdn?: boolean;
}

/**
 * A photo through Vercel's image CDN where it can be, falling back to its own
 * URL if the CDN can't serve it (a host Vercel can't reach, an outage), and
 * only then to `onFailed`, for the caller's own fallback.
 */
export function CdnImage({ src, sizes, onFailed, cdn, alt, ...rest }: Props) {
  // Which URL failed through the CDN: a new `src` gets the CDN again.
  const [direct, setDirect] = useState<string | null>(null);
  // Only a web address or an inline image ever becomes the source (imageSrc).
  const safeSrc = imageSrc(src);
  const sources: Partial<ImageSources> =
    safeSrc && direct === safeSrc ? { src: safeSrc } : safeSrc ? imageSources(safeSrc, cdn) : {};
  return (
    <img
      {...rest}
      alt={alt}
      src={sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? sizes : undefined}
      onError={() => {
        if (sources.srcSet && safeSrc) setDirect(safeSrc);
        else onFailed?.();
      }}
    />
  );
}
