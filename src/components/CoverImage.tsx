import { useState } from 'react';
import type { Category } from '../data/types';
import { CATEGORY_ICON } from '../lib/mapPins';

interface Props {
  /** Cover URL. Empty/missing renders the category fallback straight away. */
  src: string | undefined;
  /** Alt text for the cover. Empty marks it decorative, fallback included. */
  alt: string;
  /** Picks the fallback glyph, the same icon the activity's map pin uses. */
  category: Category;
  /** Classes for the <img>; the fallback always fills its container. */
  className?: string;
  loading?: 'lazy' | 'eager';
  /** Fallback glyph size in px. */
  glyphSize?: number;
}

/**
 * An activity cover that degrades to the category glyph on the placeholder
 * surface when the image is missing or fails to load (#120), instead of the
 * browser's broken-image icon. The parent owns the box (aspect ratio, radius,
 * background); both states fill it, so a failed cover never shifts layout.
 */
export function CoverImage({
  src,
  alt,
  category,
  className,
  loading,
  glyphSize = 44,
}: Props) {
  // Track the URL that failed rather than a boolean, so a new `src` (the
  // detail view swapping activities in place, or a card's cover becoming a
  // user photo) gets its own load attempt instead of inheriting the failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <img
        alt={alt}
        className={className}
        src={src}
        loading={loading}
        onError={() => setFailedSrc(src)}
      />
    );
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-surface-variant text-on-surface-variant/40"
      // A meaningful cover keeps its name when it falls back; a decorative one
      // stays invisible to assistive tech, as the empty-alt <img> was.
      {...(alt ? { role: 'img', 'aria-label': alt } : {})}
    >
      <span
        className="material-symbols-outlined"
        aria-hidden="true"
        style={{ fontSize: glyphSize }}
      >
        {CATEGORY_ICON[category]}
      </span>
    </div>
  );
}
