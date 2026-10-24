import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CDN_HOSTS,
  CDN_QUALITY,
  CDN_WIDTHS,
  cdnUrl,
  imageSources,
  imageSrc,
  isWebUrl,
  onVercel,
  viaCdn,
} from './imageCdn';

const COMMONS =
  'https://upload.wikimedia.org/wikipedia/commons/d/d5/Los_Gatos_Creek_Trail_%28Campbell%2C_California%29.jpg';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('onVercel', () => {
  it('is on for a Vercel build, preview or production, and off anywhere else', () => {
    vi.stubEnv('VITE_VERCEL_ENV', 'production');
    expect(onVercel()).toBe(true);
    vi.stubEnv('VITE_VERCEL_ENV', 'preview');
    expect(onVercel()).toBe(true);
    vi.stubEnv('VITE_VERCEL_ENV', '');
    expect(onVercel()).toBe(false);
    // vercel dev has no image CDN.
    vi.stubEnv('VITE_VERCEL_ENV', 'development');
    expect(onVercel()).toBe(false);
  });
});

describe('isWebUrl', () => {
  it('takes http and https addresses and inline images, in any case', () => {
    expect(isWebUrl(COMMONS)).toBe(true);
    expect(isWebUrl('http://img.example/a.jpg')).toBe(true);
    expect(isWebUrl('HTTPS://IMG.EXAMPLE/A.JPG')).toBe(true);
    expect(isWebUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isWebUrl('DATA:IMAGE/PNG;base64,AAAA')).toBe(true);
  });

  it('refuses every other kind of URL, and anything that only contains one', () => {
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isWebUrl('blob:https://fog-and-frontier.vercel.app/1')).toBe(false);
    expect(isWebUrl('https:img.example/a.jpg')).toBe(false);
    expect(isWebUrl('javascript:alert("https://x")')).toBe(false);
    expect(isWebUrl(' https://img.example/a.jpg')).toBe(false);
    expect(isWebUrl('/assets/cover.jpg')).toBe(false);
    expect(isWebUrl('')).toBe(false);
  });
});

describe('imageSrc', () => {
  it('keeps a web address or inline image, percent-encoding " < and >', () => {
    expect(imageSrc(COMMONS)).toBe(COMMONS);
    expect(imageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(imageSrc('https://img.example/a"b<c>d"e.jpg')).toBe(
      'https://img.example/a%22b%3Cc%3Ed%22e.jpg',
    );
    // Anything else a URL may hold stays as it is.
    expect(imageSrc("https://img.example/o'neill&co(1).jpg?w=1&h=2")).toBe(
      "https://img.example/o'neill&co(1).jpg?w=1&h=2",
    );
  });

  it('gives nothing for anything else', () => {
    expect(imageSrc('javascript:alert(1)')).toBeUndefined();
    expect(imageSrc('')).toBeUndefined();
  });
});

describe('viaCdn', () => {
  it('takes https photos on the listed hosts', () => {
    expect(viaCdn(COMMONS)).toBe(true);
    for (const host of CDN_HOSTS) expect(viaCdn(`https://${host}/a.jpg`)).toBe(true);
  });

  it('leaves any other host, plain http, and anything that isn’t a URL', () => {
    expect(viaCdn('https://example.com/a.jpg')).toBe(false);
    // A look-alike isn't the host.
    expect(viaCdn('https://upload.wikimedia.org.example.com/a.jpg')).toBe(false);
    expect(viaCdn('http://upload.wikimedia.org/a.jpg')).toBe(false);
    expect(viaCdn('/assets/cover.jpg')).toBe(false);
    expect(viaCdn('')).toBe(false);
  });
});

describe('cdnUrl', () => {
  it('asks /_vercel/image for the photo at a width and the one quality', () => {
    expect(cdnUrl(COMMONS, 640)).toBe(
      `/_vercel/image?url=${encodeURIComponent(COMMONS)}&w=640&q=75`,
    );
    expect(CDN_QUALITY).toBe(75);
  });
});

describe('imageSources', () => {
  it('serves a listed photo through the CDN, every width for the browser to choose', () => {
    expect(imageSources(COMMONS, true)).toEqual({
      src: cdnUrl(COMMONS, 960),
      srcSet: [96, 192, 384, 640, 960, 1280].map((w) => `${cdnUrl(COMMONS, w)} ${w}w`).join(', '),
    });
  });

  it('leaves a photo as it is off Vercel, or from another host', () => {
    expect(imageSources(COMMONS, false)).toEqual({ src: COMMONS });
    expect(imageSources('https://example.com/a.jpg', true)).toEqual({
      src: 'https://example.com/a.jpg',
    });
  });

  it('goes by where it was built, unless told', () => {
    vi.stubEnv('VITE_VERCEL_ENV', 'preview');
    expect(imageSources(COMMONS).srcSet).toBeDefined();
    vi.stubEnv('VITE_VERCEL_ENV', '');
    expect(imageSources(COMMONS)).toEqual({ src: COMMONS });
  });
});

describe('vercel.json', () => {
  // The CDN only serves what vercel.json allows, and refuses anything else:
  // a host, width or quality asked for here but missing there would break
  // every such photo.
  const images = (
    JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      images: {
        sizes: number[];
        qualities: number[];
        formats: string[];
        minimumCacheTTL: number;
        remotePatterns: { protocol: string; hostname: string }[];
      };
    }
  ).images;

  it('allows exactly the hosts, widths and quality the app asks for', () => {
    expect(images.remotePatterns).toEqual(
      CDN_HOSTS.map((hostname) => ({ protocol: 'https', hostname })),
    );
    expect(images.sizes).toEqual([...CDN_WIDTHS]);
    expect(images.qualities).toEqual([CDN_QUALITY]);
  });

  it('serves AVIF or WebP, cached for a month', () => {
    expect(images.formats).toEqual(['image/avif', 'image/webp']);
    expect(images.minimumCacheTTL).toBe(31 * 24 * 60 * 60);
  });
});
