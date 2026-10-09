// Photos are downscaled in the browser before upload (#19): a phone photo is
// 3-10 MB, but a 1600 px JPEG is a few hundred KB and still sharp at the
// sizes the app shows. That keeps the private Blob store well inside the
// Hobby plan's storage and transfer limits.

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

/** The size that fits within `max` on the long edge; never upscales. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Re-encodes an image file as a JPEG no larger than MAX_EDGE on its long edge. */
export async function toJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    // JPEG has no transparency: a see-through PNG gets white, not black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
