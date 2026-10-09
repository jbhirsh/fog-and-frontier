import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JPEG_QUALITY, MAX_EDGE, fitWithin, toJpeg } from './photoResize';

describe('fitWithin', () => {
  it.each([
    [4032, 3024, { width: 1600, height: 1200 }],
    [3024, 4032, { width: 1200, height: 1600 }],
    [1600, 900, { width: 1600, height: 900 }],
    [800, 600, { width: 800, height: 600 }],
    [10000, 1, { width: 1600, height: 1 }],
    [1601, 1601, { width: 1600, height: 1600 }],
  ])('%sx%s fits as %o', (w, h, want) => {
    expect(fitWithin(w, h)).toEqual(want);
  });

  it('takes another limit', () => {
    expect(fitWithin(400, 200, 100)).toEqual({ width: 100, height: 50 });
  });

  it('keeps the long edge at 1600 px and the quality at 0.85', () => {
    expect(MAX_EDGE).toBe(1600);
    expect(JPEG_QUALITY).toBe(0.85);
  });
});

describe('toJpeg', () => {
  const close = vi.fn();
  let ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> } | null;
  let encoded: Blob | null;
  let canvases: HTMLCanvasElement[];
  const bitmap = { width: 4032, height: 3024, close };

  beforeEach(() => {
    ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    encoded = new Blob(['jpeg'], { type: 'image/jpeg' });
    canvases = [];
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap)));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvases.push(this);
      return ctx as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb, type, quality) {
      expect(type).toBe('image/jpeg');
      expect(quality).toBe(JPEG_QUALITY);
      cb(encoded);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    close.mockReset();
  });

  it('draws the image, upright, onto a white canvas no larger than 1600 px', async () => {
    const file = new File(['raw'], 'photo.heic');
    await expect(toJpeg(file)).resolves.toBe(encoded);
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(canvases[0].width).toBe(1600);
    expect(canvases[0].height).toBe(1200);
    expect(ctx!.fillStyle).toBe('#fff');
    expect(ctx!.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
    expect(ctx!.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200);
    expect(ctx!.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx!.drawImage.mock.invocationCallOrder[0],
    );
    expect(close).toHaveBeenCalled();
  });

  it('fails, and still frees the image, when encoding fails', async () => {
    encoded = null;
    await expect(toJpeg(new Blob(['raw']))).rejects.toThrow('JPEG encoding failed');
    expect(close).toHaveBeenCalled();
  });

  it('fails without a 2D canvas', async () => {
    ctx = null;
    await expect(toJpeg(new Blob(['raw']))).rejects.toThrow('2D canvas unavailable');
    expect(close).toHaveBeenCalled();
  });
});
