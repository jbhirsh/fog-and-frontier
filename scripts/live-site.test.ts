import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CDN_QUALITY,
  CDN_WIDTH,
  LIVE_GRAPHQL,
  PHOTO_CACHE,
  PRODUCTION,
  cachePhotos,
  describeFailed,
  liveSite,
  osmTile,
  photoFile,
  pictureSource,
  waitForPhotos,
} from './live-site';

const temp = () => mkdtempSync(join(tmpdir(), 'live-site-'));

describe('osmTile', () => {
  it('maps a CARTO tile to the same OpenStreetMap tile', () => {
    expect(osmTile('https://a.basemaps.cartocdn.com/light_all/8/40/98.png')).toBe(
      'https://tile.openstreetmap.org/8/40/98.png',
    );
    expect(
      osmTile('https://d.basemaps.cartocdn.com/rastertiles/voyager/12/655/1582@2x.png?api_key=k'),
    ).toBeNull();
    expect(osmTile('https://c.basemaps.cartocdn.com/light_all/12/655/1582@2x.png?api_key=k')).toBe(
      'https://tile.openstreetmap.org/12/655/1582.png',
    );
    expect(osmTile('https://example.com/8/40/98.png')).toBeNull();
  });
});

describe('liveSite', () => {
  type Handler = (route: ReturnType<typeof readRoute>) => Promise<unknown>;
  async function routes(api?: string) {
    const added: [string | RegExp, Handler][] = [];
    const page = {
      route: vi.fn((match: string | RegExp, h: Handler) => {
        added.push([match, h]);
        return Promise.resolve();
      }),
    };
    await liveSite(page as unknown as Parameters<typeof liveSite>[0], api);
    return added;
  }
  function readRoute(body: { query?: string; operationName?: string } | null, response?: unknown) {
    return {
      request: () => ({ postDataJSON: () => body }),
      fetch: vi.fn(() =>
        response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      ),
      fulfill: vi.fn(() => Promise.resolve()),
      fallback: vi.fn(() => Promise.resolve()),
      continue: vi.fn(() => Promise.resolve()),
    };
  }
  const answer = (json: unknown, ok = true) => ({
    ok: () => ok,
    json: () => Promise.resolve(json),
  });
  const read = (name: string) => ({ operationName: name, query: `query ${name} { a }` });

  it('routes the API, then the fonts', async () => {
    expect((await routes()).map(([match]) => String(match))).toEqual([
      '**/api/graphql',
      String(/fonts\.(googleapis|gstatic)\.com/),
    ]);
  });

  it('answers every read from production', async () => {
    const [[, reads]] = await routes();
    const response = answer({ data: { activities: [] } });
    const r = readRoute(
      { operationName: 'Activities', query: 'query Activities { activities { id } }' },
      response,
    );
    await reads(r);
    expect(r.fetch).toHaveBeenCalledWith({ url: LIVE_GRAPHQL });
    expect(r.fulfill).toHaveBeenCalledWith({ response, json: { data: { activities: [] } } });
    expect(r.fallback).not.toHaveBeenCalled();
    expect(PRODUCTION).toBe('https://fog-and-frontier.vercel.app');
    expect(LIVE_GRAPHQL).toBe('https://fog-and-frontier.vercel.app/api/graphql');
    // Any other production, and a read with space before it.
    const [[, other]] = await routes('https://example.com/api/graphql');
    const r2 = readRoute(
      { query: '  query DrivingMiles { drivingMiles { id } }' },
      answer({ data: {} }),
    );
    await other(r2);
    expect(r2.fetch).toHaveBeenCalledWith({ url: 'https://example.com/api/graphql' });
  });

  it('leaves writes, and anything that isn’t a read, to the stub', async () => {
    const [[, reads]] = await routes();
    for (const body of [
      { query: 'mutation SaveActivity { saveActivity { id } }' },
      { query: 'queryless' },
      {},
      null,
    ]) {
      const r = readRoute(body);
      await reads(r);
      expect(r.fetch).not.toHaveBeenCalled();
      expect(r.fallback).toHaveBeenCalledTimes(1);
    }
  });

  it('gives a read production can’t answer to the stub, saying so once a read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [[, reads]] = await routes();
      for (const response of [
        answer({ errors: [{ message: 'Not signed in' }] }),
        answer({ data: {} }, false),
        new Error('offline'),
      ]) {
        const r = readRoute(read('TripsList'), response);
        await reads(r);
        expect(r.fallback).toHaveBeenCalledTimes(1);
        expect(r.fulfill).not.toHaveBeenCalled();
      }
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        `pr-gif: ${LIVE_GRAPHQL} couldn't answer TripsList, so the stub did`,
      );
      // Another read gets its own note; one with no name is "a read".
      await reads(readRoute(read('TripDetail'), new Error('offline')));
      await reads(readRoute({ query: 'query { a }' }, new Error('offline')));
      expect(warn).toHaveBeenLastCalledWith(
        `pr-gif: ${LIVE_GRAPHQL} couldn't answer a read, so the stub did`,
      );
      expect(warn).toHaveBeenCalledTimes(3);
      // An empty errors list is still an answer.
      const r = readRoute(read('A'), answer({ data: {}, errors: [] }));
      await reads(r);
      expect(r.fulfill).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('lets the fonts through to the network', async () => {
    const [, [, fonts]] = await routes();
    const r = readRoute(null);
    await fonts(r);
    expect(r.continue).toHaveBeenCalledTimes(1);
  });
});

describe('pictureSource', () => {
  const PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Library.jpg';
  const viaProduction = (url: string) =>
    `${PRODUCTION}/_vercel/image?url=${encodeURIComponent(url)}&w=1280&q=75`;

  it('takes a photo through production’s image CDN, its own URL next', () => {
    expect(pictureSource(PHOTO)).toEqual({ url: viaProduction(PHOTO), direct: PHOTO });
    expect(pictureSource('http://img.example/a.png')).toEqual({
      url: viaProduction('http://img.example/a.png'),
      direct: 'http://img.example/a.png',
    });
    // At the CDN's largest width and its one quality, as vercel.json lists them.
    const images = (
      JSON.parse(readFileSync('vercel.json', 'utf8')) as {
        images: { sizes: number[]; qualities: number[] };
      }
    ).images;
    expect(CDN_WIDTH).toBe(Math.max(...images.sizes));
    expect(images.qualities).toEqual([CDN_QUALITY]);
  });

  it('sends the build’s own image CDN requests to production’s', () => {
    const asked = `/_vercel/image?url=${encodeURIComponent(PHOTO)}&w=384&q=75`;
    expect(pictureSource(`http://localhost:4173${asked}`)).toEqual({
      url: `${PRODUCTION}${asked}`,
      direct: PHOTO,
    });
    expect(pictureSource('http://localhost:4173/_vercel/image?w=384', 'https://x.app')).toEqual({
      url: 'https://x.app/_vercel/image?w=384',
      direct: undefined,
    });
  });

  it('draws OpenStreetMap tiles in place of CARTO ones', () => {
    expect(pictureSource('https://b.basemaps.cartocdn.com/light_all/9/81/197.png')).toEqual({
      url: 'https://tile.openstreetmap.org/9/81/197.png',
    });
  });

  it('asks production another site was given', () => {
    expect(pictureSource(PHOTO, 'https://x.app')?.url).toBe(
      `https://x.app/_vercel/image?url=${encodeURIComponent(PHOTO)}&w=1280&q=75`,
    );
  });

  it('leaves the build’s own pictures, and anything that isn’t a web address, alone', () => {
    expect(pictureSource('http://localhost:4173/icon.png')).toBeNull();
    expect(pictureSource('http://127.0.0.1:4173/icon.png')).toBeNull();
    expect(pictureSource('data:image/png;base64,AAAA')).toBeNull();
    expect(pictureSource('not a url.png')).toBeNull();
  });
});

describe('waitForPhotos', () => {
  it('waits for the photos in view to load', async () => {
    const waitForFunction = vi.fn(() => Promise.resolve());
    expect(
      await waitForPhotos(
        { waitForFunction } as unknown as Parameters<typeof waitForPhotos>[0],
        5000,
      ),
    ).toBe(true);
    expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, {
      timeout: 5000,
    });
  });

  it('gives up with a warning, not an error, after 20 s by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const waitForFunction = vi.fn(() => Promise.reject(new Error('Timeout')));
      expect(await waitForPhotos({ waitForFunction })).toBe(false);
      expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, {
        timeout: 20_000,
      });
      expect(warn).toHaveBeenCalledWith("pr-gif: some photos in view hadn't loaded after 20 s");
    } finally {
      warn.mockRestore();
    }
  });

  it('counts a photo loaded or broken, out of view, or with no src', async () => {
    // The check itself, run here against jsdom's images.
    let check: () => boolean = () => false;
    const waitForFunction = vi.fn((fn: () => boolean) => {
      check = fn;
      return Promise.resolve();
    });
    await waitForPhotos({ waitForFunction } as unknown as Parameters<typeof waitForPhotos>[0]);
    const img = document.createElement('img');
    document.body.append(img);
    const box = (top: number, width = 100) =>
      vi
        .spyOn(img, 'getBoundingClientRect')
        .mockReturnValue({ top, bottom: top + 50, width } as DOMRect);
    const complete = (value: boolean) =>
      Object.defineProperty(img, 'complete', { value, configurable: true });
    try {
      box(10);
      // A lazy photo in view that hasn't started yet still counts.
      img.setAttribute('src', 'https://upload.wikimedia.org/a.jpg');
      img.loading = 'lazy';
      complete(false);
      expect(check()).toBe(false);
      // Loaded, or broken: either way, what the site shows.
      complete(true);
      expect(check()).toBe(true);
      complete(false);
      // Below the fold, above it, or not laid out.
      box(5000);
      expect(check()).toBe(true);
      box(-60);
      expect(check()).toBe(true);
      box(10, 0);
      expect(check()).toBe(true);
      // No src.
      box(10);
      img.removeAttribute('src');
      expect(check()).toBe(true);
    } finally {
      img.remove();
    }
  });
});

describe('cachePhotos', () => {
  type Handler = (route: ReturnType<typeof photoRoute>) => Promise<unknown>;
  async function setUp(cache: string, production?: string) {
    let added: [(url: URL) => boolean, Handler] | undefined;
    const page = {
      route: vi.fn((match: (url: URL) => boolean, h: Handler) => {
        added = [match, h];
        return Promise.resolve();
      }),
    };
    const { failed } = await cachePhotos(page as unknown as Parameters<typeof cachePhotos>[0], {
      cache,
      production,
    });
    return { handler: added![1], match: (url: string) => added![0](new URL(url)), failed };
  }
  // A route whose fetches answer, in turn, with `responses` (an Error throws).
  function photoRoute(url: string, ...responses: unknown[]) {
    let n = 0;
    return {
      request: () => ({ url: () => url }),
      fetch: vi.fn(() => {
        const response = responses[n++];
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      }),
      fulfill: vi.fn(() => Promise.resolve()),
      fallback: vi.fn(() => Promise.resolve()),
      abort: vi.fn(() => Promise.resolve()),
    };
  }
  const ok = (body: string, type?: string) => ({
    ok: () => true,
    status: () => 200,
    body: () => Promise.resolve(Buffer.from(body)),
    headers: () => (type ? { 'content-type': type } : {}),
  });
  const refused = (status: number) => ({
    ok: () => false,
    status: () => status,
    headers: () => ({}),
  });
  const URL_A = 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Library.jpg';
  const CDN_A = pictureSource(URL_A)!.url;

  it('keeps photos in ~/.cache/pr-gif/photos by default, one file per URL', () => {
    expect(PHOTO_CACHE).toBe(join(homedir(), '.cache', 'pr-gif', 'photos'));
    expect(photoFile('/c', URL_A)).toBe(join('/c', createHash('sha1').update(URL_A).digest('hex')));
  });

  it('takes images and image CDN requests, and nothing else', async () => {
    const { match } = await setUp(temp());
    expect(match(URL_A)).toBe(true);
    expect(match('https://tile.openstreetmap.org/9/81/197.png?x=1')).toBe(true);
    expect(match('http://localhost:4173/_vercel/image?url=x&w=96&q=75')).toBe(true);
    expect(match('http://localhost:4173/api/graphql')).toBe(false);
    expect(match('https://fonts.gstatic.com/s/inter.woff2')).toBe(false);
  });

  it('fetches a photo once through production’s CDN, then serves it from disk', async () => {
    const cache = join(temp(), 'photos');
    const { handler, failed } = await setUp(cache);
    const response = ok('avif bytes', 'image/avif');
    const first = photoRoute(URL_A, response);
    await handler(first);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(first.fetch).toHaveBeenCalledWith({ url: CDN_A });
    expect(first.fulfill).toHaveBeenCalledWith({ response, body: Buffer.from('avif bytes') });
    expect(readFileSync(photoFile(cache, CDN_A), 'utf8')).toBe('avif bytes');
    expect(readFileSync(`${photoFile(cache, CDN_A)}.type`, 'utf8')).toBe('image/avif');

    // The next recording, or the next run: no fetch.
    const again = await setUp(cache);
    const second = photoRoute(URL_A);
    await again.handler(second);
    expect(second.fetch).not.toHaveBeenCalled();
    expect(second.fulfill).toHaveBeenCalledWith({
      body: Buffer.from('avif bytes'),
      contentType: 'image/avif',
    });
    expect(failed.size).toBe(0);
  });

  it('asks the production it was given', async () => {
    const { handler } = await setUp(temp(), 'https://x.app');
    const r = photoRoute(URL_A, ok('bytes'));
    await handler(r);
    expect(r.fetch).toHaveBeenCalledWith({ url: pictureSource(URL_A, 'https://x.app')!.url });
  });

  it('falls back to the photo’s own URL when production’s CDN can’t serve it', async () => {
    const cache = temp();
    const { handler, failed } = await setUp(cache);
    for (const cdnAnswer of [refused(400), new Error('net::ERR_FAILED')]) {
      const response = ok('jpeg bytes', 'image/jpeg');
      const r = photoRoute(URL_A, cdnAnswer, response);
      await handler(r);
      expect(r.fetch).toHaveBeenNthCalledWith(1, { url: CDN_A });
      expect(r.fetch).toHaveBeenNthCalledWith(2, { url: URL_A });
      expect(r.fulfill).toHaveBeenCalledWith({ response, body: Buffer.from('jpeg bytes') });
      rmSync(cache, { recursive: true, force: true });
      mkdirSync(cache, { recursive: true });
    }
    expect(failed.size).toBe(0);
  });

  it('takes only an image: a site without the CDN answers with its index.html', async () => {
    const cache = temp();
    const { handler, failed } = await setUp(cache);
    const response = ok('jpeg bytes', 'image/jpeg');
    const r = photoRoute(URL_A, ok('<!doctype html>', 'text/html; charset=utf-8'), response);
    await handler(r);
    expect(r.fetch).toHaveBeenNthCalledWith(2, { url: URL_A });
    expect(r.fulfill).toHaveBeenCalledWith({ response, body: Buffer.from('jpeg bytes') });
    expect(readFileSync(photoFile(cache, CDN_A), 'utf8')).toBe('jpeg bytes');
    // HTML both ways is a gap, passed on as it came.
    const html = ok('<!doctype html>', 'text/html');
    const r2 = photoRoute('https://www.nps.gov/b.jpg', ok('x', 'text/html'), html);
    await handler(r2);
    expect(r2.fulfill).toHaveBeenCalledWith({ response: html });
    expect(failed.get('https://www.nps.gov/b.jpg')).toBe('not an image (text/html)');
  });

  it('assumes a JPEG when the host doesn’t say', async () => {
    const cache = temp();
    const { handler } = await setUp(cache);
    await handler(photoRoute(URL_A, ok('bytes')));
    expect(readFileSync(`${photoFile(cache, CDN_A)}.type`, 'utf8')).toBe('image/jpeg');
  });

  it('notes a photo refused both ways by its own URL, passes the refusal on, and doesn’t cache it', async () => {
    const cache = temp();
    const { handler, failed } = await setUp(cache);
    const response = refused(429);
    const r = photoRoute(URL_A, refused(400), response);
    await handler(r);
    expect(r.fulfill).toHaveBeenCalledWith({ response });
    expect(failed).toEqual(new Map([[URL_A, 'HTTP 429']]));
    expect(existsSync(photoFile(cache, CDN_A))).toBe(false);
    // Loaded on a later try: no longer a gap.
    await handler(photoRoute(URL_A, ok('bytes')));
    expect(failed.size).toBe(0);
  });

  it('notes a photo it couldn’t reach at all, and aborts it', async () => {
    const { handler, failed } = await setUp(temp());
    const r = photoRoute(
      URL_A,
      new Error('offline'),
      new Error('net::ERR_CONNECTION_RESET\nmore detail'),
    );
    await handler(r);
    expect(r.abort).toHaveBeenCalledTimes(1);
    expect(failed.get(URL_A)).toBe('net::ERR_CONNECTION_RESET');
  });

  it('fetches a map tile from OpenStreetMap only, named as the tile', async () => {
    const { handler, failed } = await setUp(temp());
    const tile = 'https://b.basemaps.cartocdn.com/light_all/9/81/197.png';
    const r = photoRoute(tile, refused(503));
    await handler(r);
    expect(r.fetch).toHaveBeenCalledTimes(1);
    expect(r.fetch).toHaveBeenCalledWith({ url: 'https://tile.openstreetmap.org/9/81/197.png' });
    expect(failed).toEqual(new Map([['https://tile.openstreetmap.org/9/81/197.png', 'HTTP 503']]));
  });

  it('leaves the build’s own pictures to its server', async () => {
    const { handler } = await setUp(temp());
    const r = photoRoute('http://localhost:4173/icon.png');
    await handler(r);
    expect(r.fallback).toHaveBeenCalledTimes(1);
    expect(r.fetch).not.toHaveBeenCalled();
  });
});

describe('describeFailed', () => {
  it('counts the failed photos by host, with why', () => {
    expect(
      describeFailed(
        new Map([
          ['https://upload.wikimedia.org/a.jpg', 'HTTP 429'],
          ['https://upload.wikimedia.org/b.jpg', 'HTTP 429'],
          ['https://upload.wikimedia.org/c.jpg', 'HTTP 503'],
          ['https://www.nps.gov/d.jpg', 'net::ERR_TIMED_OUT'],
          ['not a url', 'HTTP 404'],
        ]),
      ),
    ).toBe(
      '3 from upload.wikimedia.org (HTTP 429, HTTP 503); 1 from www.nps.gov (net::ERR_TIMED_OUT); 1 from not a url (HTTP 404)',
    );
    expect(describeFailed(new Map())).toBe('');
  });
});
