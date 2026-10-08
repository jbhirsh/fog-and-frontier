import { describe, expect, it } from 'vitest';
import manifestSource from '../../public/manifest.webmanifest?raw';
import html from '../../index.html?raw';
import icon192 from '../../public/icon-192.png?inline';
import icon512 from '../../public/icon-512.png?inline';
import appleTouchIcon from '../../public/apple-touch-icon.png?inline';

// Home-screen install (#52). Chrome rejects icons whose bytes don't match the
// declared type, and the old icons were JPEGs named .png, so check the real
// format and size of every icon the manifest and index.html point at.

const manifest = JSON.parse(manifestSource) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string }[];
};

// `?inline` gives a base64 data URL of the file's bytes.
const ICON_BYTES: Record<string, string> = {
  '/icon-192.png': icon192,
  '/icon-512.png': icon512,
  '/apple-touch-icon.png': appleTouchIcon,
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Width x height from a PNG's IHDR chunk, or null if the bytes aren't a PNG.
function pngSize(src: string): string | null {
  const binary = atob(ICON_BYTES[src].split(',')[1]);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (binary.slice(12, 16) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

describe('web app manifest', () => {
  it('has what Chrome needs to offer an install', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Fog and Frontier',
      short_name: 'Fog & Frontier',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
  });

  it.each(manifest.icons)('ships $src as a real PNG of its declared size', (icon) => {
    expect(icon.type).toBe('image/png');
    expect(pngSize(icon.src)).toBe(icon.sizes);
  });

  it('is linked from index.html, with the same theme color', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
    expect(manifest.background_color).toBe(manifest.theme_color);
  });
});

describe('home-screen tags', () => {
  it('opens standalone, labeled with the short name, under the default status bar', () => {
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Fog &amp; Frontier" />');
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    );
  });

  it('ships the apple-touch-icon as a real 180px PNG', () => {
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    );
    expect(pngSize('/apple-touch-icon.png')).toBe('180x180');
  });
});
