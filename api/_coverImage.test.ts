import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  WIKIMEDIA_HEADERS,
  findCoverImage,
  formatCredit,
  haversineMeters,
  httpsUrl,
  isUnwantedTitle,
  nameMatchScore,
  nameTokens,
  nearbyPageImages,
  pickImage,
  rankCommonsCandidates,
  searchRadiusMeters,
  stripHtml,
  type CoverPlace,
  type ImageInfo,
} from './_coverImage.js';

// Exactly `m` metres due north of `lat` (a meridian arc is exact under the
// haversine formula's spherical earth).
const R = 6371000;
function northOf(lat: number, m: number): number {
  return lat + ((m / R) * 180) / Math.PI;
}

describe('httpsUrl', () => {
  it('accepts only an https URL string', () => {
    expect(httpsUrl('https://upload.wikimedia.org/a.jpg')).toBe(
      'https://upload.wikimedia.org/a.jpg',
    );
    expect(httpsUrl('http://upload.wikimedia.org/a.jpg')).toBeNull();
    expect(httpsUrl('javascript:alert(1)')).toBeNull();
    expect(httpsUrl('a.jpg')).toBeNull();
    expect(httpsUrl(42)).toBeNull();
    expect(httpsUrl(undefined)).toBeNull();
    // Only strings: a URL object would stringify to an https URL.
    expect(httpsUrl(new URL('https://upload.wikimedia.org/a.jpg'))).toBeNull();
  });
});

describe('searchRadiusMeters', () => {
  it('searches wider for outdoor categories than for one building', () => {
    for (const c of ['hiking', 'camping', 'climbing', 'scenic', 'water', 'cycling']) {
      expect(searchRadiusMeters(c)).toBe(1500);
    }
    expect(searchRadiusMeters('food')).toBe(300);
    expect(searchRadiusMeters('culture')).toBe(500);
    expect(searchRadiusMeters('other')).toBe(750);
    expect(searchRadiusMeters('unknown')).toBe(750);
  });
});

describe('nameTokens', () => {
  it('lowercases, folds accents, drops single letters and generic words', () => {
    expect(nameTokens("Lover's Point Park and Beach")).toEqual(['lover', 'point', 'beach']);
    expect(nameTokens('Café Borrone')).toEqual(['cafe', 'borrone']);
  });

  it('stems plurals of longer words only, and dedupes', () => {
    expect(nameTokens('Alamere Falls Fall')).toEqual(['alamere', 'fall']);
    expect(nameTokens('Gas Works')).toEqual(['gas', 'work']);
  });

  it('keeps generic words when the name has nothing else', () => {
    expect(nameTokens('The State Park')).toEqual(['the', 'state', 'park']);
  });

  it('is empty for a name with no words', () => {
    expect(nameTokens('— ! —')).toEqual([]);
  });
});

describe('nameMatchScore', () => {
  it('is the share of name tokens found in the title', () => {
    expect(nameMatchScore('Castle Rock State Park', 'File:Castle Rock view.jpg')).toBe(1);
    expect(nameMatchScore('Alamere Falls', 'File:Alamere fall, 2019.jpg')).toBe(1);
    expect(nameMatchScore('Castle Rock', 'File:Rock with a View.jpg')).toBe(0.5);
    expect(nameMatchScore('Castle Rock', 'File:Sunset.jpg')).toBe(0);
  });

  it('matches across accents and case', () => {
    expect(nameMatchScore('Café Borrone', 'File:CAFE BORRONE (Menlo Park).JPG')).toBe(1);
  });

  it('keeps short words unstemmed on both sides', () => {
    expect(nameMatchScore('Gas Works', 'File:Ga works.jpg')).toBe(0.5);
  });

  it('is 0 for a name without tokens', () => {
    expect(nameMatchScore('!!', 'File:Anything.jpg')).toBe(0);
  });
});

describe('isUnwantedTitle', () => {
  it('accepts raster photo files, any extension case', () => {
    expect(isUnwantedTitle('File:Castle Rock.jpg')).toBe(false);
    expect(isUnwantedTitle('File:Castle Rock.JPEG')).toBe(false);
    expect(isUnwantedTitle('File:Castle Rock.png')).toBe(false);
    expect(isUnwantedTitle('File:Castle Rock.webp')).toBe(false);
  });

  it('rejects non-raster or extension-less files', () => {
    expect(isUnwantedTitle('File:Castle Rock.svg')).toBe(true);
    expect(isUnwantedTitle('File:Castle Rock.tif')).toBe(true);
    expect(isUnwantedTitle('File:Castle Rock.pdf')).toBe(true);
    expect(isUnwantedTitle('File:Castle Rock')).toBe(true);
  });

  it('rejects maps, logos, icons, diagrams, signatures and rasterized SVGs', () => {
    for (const t of [
      'File:Map of Castle Rock.jpg',
      'File:Castle Rock logo.png',
      'File:Park icon.png',
      'File:Trail diagram.jpg',
      'File:Signature of John Muir.jpg',
      'File:Castle Rock.svg.png',
      'File:Coat of arms of Los Gatos.png',
      'File:Coat of  arms (old).jpg',
      'File:Museum floor plan.jpg',
    ]) {
      expect(isUnwantedTitle(t)).toBe(true);
    }
  });

  it('matches unwanted phrases as whole words only', () => {
    expect(isUnwantedTitle('File:Redcoat of armstrong.jpg')).toBe(false);
    expect(isUnwantedTitle('File:Mapleton Road.jpg')).toBe(false);
  });
});

describe('rankCommonsCandidates', () => {
  const hike = { name: 'Castle Rock', category: 'hiking' };
  const food = { name: 'Orchard City Kitchen', category: 'food' };

  it('drops unwanted titles and anything outside the category radius', () => {
    const out = rankCommonsCandidates(hike, [
      { title: 'File:Castle Rock map.jpg', dist: 10 },
      { title: 'File:Castle Rock.svg', dist: 10 },
      { title: 'File:Castle Rock edge.jpg', dist: 1500 },
      { title: 'File:Castle Rock beyond.jpg', dist: 1501 },
    ]);
    expect(out.map((c) => c.title)).toEqual(['File:Castle Rock edge.jpg']);
  });

  it('ranks a name match above a closer unmatched photo', () => {
    const out = rankCommonsCandidates(hike, [
      { title: 'File:Sunset over ridge.jpg', dist: 0 },
      { title: 'File:Castle Rock far.jpg', dist: 1400 },
    ]);
    expect(out.map((c) => c.title)).toEqual([
      'File:Castle Rock far.jpg',
      'File:Sunset over ridge.jpg',
    ]);
  });

  it('ranks closer first at equal name match, and fuller match first', () => {
    const out = rankCommonsCandidates(hike, [
      { title: 'File:Castle Rock far.jpg', dist: 900 },
      { title: 'File:Rock only.jpg', dist: 50 },
      { title: 'File:Castle Rock near.jpg', dist: 100 },
    ]);
    expect(out.map((c) => c.title)).toEqual([
      'File:Castle Rock near.jpg',
      'File:Castle Rock far.jpg',
      'File:Rock only.jpg',
    ]);
  });

  it('keeps an unmatched outdoor photo only within the unmatched cutoff', () => {
    const out = rankCommonsCandidates(hike, [
      { title: 'File:IMG 1234.jpg', dist: 400 },
      { title: 'File:IMG 5678.jpg', dist: 401 },
    ]);
    expect(out.map((c) => c.title)).toEqual(['File:IMG 1234.jpg']);
  });

  it('never keeps an unmatched photo for a single-building category', () => {
    const out = rankCommonsCandidates(food, [
      { title: 'File:Street corner.jpg', dist: 5 },
      { title: 'File:Orchard City Kitchen patio.jpg', dist: 250 },
    ]);
    expect(out.map((c) => c.title)).toEqual(['File:Orchard City Kitchen patio.jpg']);
  });
});

describe('haversineMeters', () => {
  it('measures great-circle distance', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111195, -1);
    // San Francisco → Los Angeles, ~559 km.
    const d = haversineMeters(
      { lat: 37.7749, lng: -122.4194 },
      { lat: 34.0522, lng: -118.2437 },
    );
    expect(d).toBeGreaterThan(558_500);
    expect(d).toBeLessThan(559_700);
    expect(haversineMeters({ lat: 10, lng: 0 }, { lat: northOf(10, 2000), lng: 0 })).toBeCloseTo(
      2000,
      6,
    );
  });
});

describe('stripHtml', () => {
  it('drops tags, decodes common entities and collapses whitespace', () => {
    expect(
      stripHtml(
        '  <a href="//commons.wikimedia.org/wiki/User:Jo" title="x">Jo&nbsp;&amp; Al</a>\n<span>O&#39;Neil &quot;Q&quot; &lt;3&gt; &apos;</span>  ',
      ),
    ).toBe('Jo & Al O\'Neil "Q" <3> \'');
    expect(stripHtml('a<>b')).toBe('a b');
  });
});

describe('formatCredit', () => {
  it('credits author, license and source', () => {
    expect(formatCredit('<b>Jo</b>', 'CC BY-SA 4.0')).toBe(
      'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons',
    );
  });

  it('leaves out a missing author or license', () => {
    expect(formatCredit(undefined, 'Public domain')).toBe(
      'Photo: Public domain, via Wikimedia Commons',
    );
    expect(formatCredit('Jo', 42)).toBe('Photo: Jo, via Wikimedia Commons');
    expect(formatCredit('<span></span>', '')).toBe('Photo: via Wikimedia Commons');
  });

  it('truncates a very long author to 80 characters', () => {
    const exact = 'a'.repeat(80);
    expect(formatCredit(exact, 'L')).toBe(`Photo: ${exact}, L, via Wikimedia Commons`);
    expect(formatCredit('b'.repeat(81), 'L')).toBe(
      `Photo: ${'b'.repeat(79)}…, L, via Wikimedia Commons`,
    );
  });
});

describe('pickImage', () => {
  const good: ImageInfo = {
    mime: 'image/jpeg',
    width: 800,
    height: 450,
    url: 'https://upload.wikimedia.org/a.jpg',
    thumburl: 'https://upload.wikimedia.org/thumb/a.jpg/1280px-a.jpg',
    extmetadata: {
      Artist: { value: 'Jo' },
      LicenseShortName: { value: 'CC BY 4.0' },
    },
  };

  it('returns the thumbnail URL and the credit', () => {
    expect(pickImage(good)).toEqual({
      url: 'https://upload.wikimedia.org/thumb/a.jpg/1280px-a.jpg',
      credit: 'Photo: Jo, CC BY 4.0, via Wikimedia Commons',
    });
  });

  it('falls back to the original URL without a thumbnail', () => {
    expect(pickImage({ ...good, thumburl: undefined })?.url).toBe(
      'https://upload.wikimedia.org/a.jpg',
    );
  });

  it('credits Commons alone when metadata is missing', () => {
    expect(pickImage({ ...good, extmetadata: undefined })?.credit).toBe(
      'Photo: via Wikimedia Commons',
    );
    expect(pickImage({ ...good, extmetadata: {} })?.credit).toBe(
      'Photo: via Wikimedia Commons',
    );
  });

  it('accepts png and webp', () => {
    expect(pickImage({ ...good, mime: 'image/png' })).not.toBeNull();
    expect(pickImage({ ...good, mime: 'image/webp' })).not.toBeNull();
  });

  it('rejects missing info, non-raster mimes, small images and non-https URLs', () => {
    expect(pickImage(undefined)).toBeNull();
    expect(pickImage({ ...good, mime: 'image/svg+xml' })).toBeNull();
    expect(pickImage({ ...good, mime: 'image/gif' })).toBeNull();
    expect(pickImage({ ...good, mime: undefined })).toBeNull();
    expect(pickImage({ ...good, width: 799 })).toBeNull();
    expect(pickImage({ ...good, height: 449 })).toBeNull();
    expect(pickImage({ ...good, width: undefined })).toBeNull();
    expect(pickImage({ ...good, height: '4000' })).toBeNull();
    expect(pickImage({ ...good, thumburl: 'http://upload.wikimedia.org/a.jpg' })).toBeNull();
    expect(pickImage({ ...good, thumburl: undefined, url: undefined })).toBeNull();
  });
});

describe('nearbyPageImages', () => {
  const place: CoverPlace = { name: 'Castle Rock State Park', category: 'hiking', lat: 37.2, lng: -122.1 };
  const at = (m: number) => [{ lat: northOf(37.2, m), lon: -122.1 }];

  it('keeps name-matching articles within 2 km, in search-rank order', () => {
    const out = nearbyPageImages(place, [
      { title: 'Castle Rock (Santa Cruz)', index: 2, pageimage: 'Second_rock_view.jpg', coordinates: at(10) },
      { title: 'Castle Rock State Park (California)', index: 1, pageimage: 'Castle_Rock_SP.jpg', coordinates: at(2000) },
    ]);
    expect(out).toEqual(['File:Castle Rock SP.jpg', 'File:Second rock view.jpg']);
  });

  it('drops an article more than 2 km away', () => {
    expect(
      nearbyPageImages(place, [
        { title: 'Castle Rock', index: 1, pageimage: 'A.jpg', coordinates: at(2001) },
      ]),
    ).toEqual([]);
  });

  it('needs at least half the name tokens in the article title', () => {
    const half = { ...place, name: 'Castle Rock' };
    expect(
      nearbyPageImages(half, [
        { title: 'Rock', index: 1, pageimage: 'A.jpg', coordinates: at(0) },
        { title: 'Campbell, California', index: 2, pageimage: 'B.jpg', coordinates: at(0) },
      ]),
    ).toEqual(['File:A.jpg']);
    expect(
      nearbyPageImages({ ...place, name: 'Orchard City Kitchen' }, [
        { title: 'Orchard Supply', index: 1, pageimage: 'C.jpg', coordinates: at(0) },
      ]),
    ).toEqual([]);
  });

  it('skips pages missing a title, page image or coordinates, and unwanted files', () => {
    expect(
      nearbyPageImages(place, [
        { index: 1, pageimage: 'A.jpg', coordinates: at(0) },
        { title: 'Castle Rock', index: 2, coordinates: at(0) },
        { title: 'Castle Rock', index: 3, pageimage: 'B.jpg' },
        { title: 'Castle Rock', index: 4, pageimage: 'C.jpg', coordinates: [{ lon: -122.1 }] },
        { title: 'Castle Rock', index: 5, pageimage: 'D.jpg', coordinates: [{ lat: 37.2 }] },
        { title: 'Castle Rock', index: 6, pageimage: 'Castle_Rock_locator_map.png', coordinates: at(0) },
        { title: 'Castle Rock', index: 7, pageimage: 'Castle_Rock.svg', coordinates: at(0) },
      ]),
    ).toEqual([]);
  });
});

// --- fetch flow ------------------------------------------------------------

type Route = (params: URLSearchParams, host: string) => unknown;

type Call = { url: URL; init: RequestInit };

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 503,
    json: () => Promise.resolve(body),
  });
}

// Stubs global fetch; `route` returns the JSON body for each request, or a
// Promise to control the response itself.
function stubFetch(route: Route): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      const body = route(url.searchParams, url.host);
      return body instanceof Promise ? body : jsonResponse(body);
    }),
  );
  return calls;
}

const PLACE: CoverPlace = { name: 'Castle Rock', category: 'hiking', lat: 37.2316, lng: -122.1169 };

function info(url: string, extra: Partial<ImageInfo> = {}): ImageInfo {
  return {
    mime: 'image/jpeg',
    width: 4000,
    height: 3000,
    url,
    thumburl: `${url}/1280px`,
    extmetadata: { Artist: { value: 'Jo' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
    ...extra,
  };
}

function pages(entries: Record<string, ImageInfo | undefined>) {
  return {
    query: {
      pages: Object.entries(entries).map(([title, ii]) =>
        ii ? { title, imageinfo: [ii] } : { title, missing: true },
      ),
    },
  };
}

const COMMONS = 'commons.wikimedia.org';
const WIKIPEDIA = 'en.wikipedia.org';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('findCoverImage', () => {
  it('returns the best-ranked usable Commons image', async () => {
    const calls = stubFetch((p) => {
      if (p.get('list') === 'geosearch') {
        return {
          query: {
            geosearch: [
              { title: 'File:Trees of Castle Rock.jpg', dist: 350 },
              { title: 'File:Castle Rock map.png', dist: 5 },
              { title: 'File:Castle Rock top.jpg', dist: 100 },
              { title: 'File:No dist.jpg' },
              { dist: 3 },
            ],
          },
        };
      }
      // Returned out of order, and the top-ranked file is too small.
      return pages({
        'File:Trees of Castle Rock.jpg': info('https://u.org/trees'),
        'File:Castle Rock top.jpg': info('https://u.org/top', { width: 640 }),
      });
    });
    expect(await findCoverImage(PLACE)).toEqual({
      url: 'https://u.org/trees/1280px',
      credit: 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons',
    });
    expect(calls).toHaveLength(2);

    const geo = calls[0].url;
    expect(geo.host).toBe(COMMONS);
    expect(geo.pathname).toBe('/w/api.php');
    expect(Object.fromEntries(geo.searchParams)).toEqual({
      format: 'json',
      formatversion: '2',
      action: 'query',
      list: 'geosearch',
      gscoord: '37.2316|-122.1169',
      gsradius: '1500',
      gsnamespace: '6',
      gslimit: '50',
    });

    const ii = calls[1].url;
    expect(ii.host).toBe(COMMONS);
    expect(Object.fromEntries(ii.searchParams)).toEqual({
      format: 'json',
      formatversion: '2',
      action: 'query',
      prop: 'imageinfo',
      titles: 'File:Castle Rock top.jpg|File:Trees of Castle Rock.jpg',
      iiprop: 'url|extmetadata|mime|size',
      iiurlwidth: '1280',
      iiextmetadatafilter: 'Artist|LicenseShortName',
    });
  });

  it('identifies itself to Wikimedia and passes an abort signal', async () => {
    const calls = stubFetch(() => ({ query: {} }));
    await findCoverImage(PLACE);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.init.headers).toEqual(WIKIMEDIA_HEADERS);
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(WIKIMEDIA_HEADERS).toEqual({
      'User-Agent': 'FogAndFrontier/1.0 (https://github.com/jbhirsh/fog-and-frontier)',
      'Api-User-Agent': 'FogAndFrontier/1.0 (https://github.com/jbhirsh/fog-and-frontier)',
    });
  });

  it('looks up at most 10 Commons candidates', async () => {
    const geosearch = Array.from({ length: 12 }, (_, i) => ({
      title: `File:Castle Rock ${String(i).padStart(2, '0')}.jpg`,
      dist: 100 + i,
    }));
    const calls = stubFetch((p) =>
      p.get('list') === 'geosearch' ? { query: { geosearch } } : { query: {} },
    );
    await findCoverImage(PLACE);
    const titles = calls[1].url.searchParams.get('titles')?.split('|');
    expect(titles).toEqual(geosearch.slice(0, 10).map((g) => g.title));
  });

  it('skips a missing Commons page and takes the next candidate', async () => {
    stubFetch((p) =>
      p.get('list') === 'geosearch'
        ? {
            query: {
              geosearch: [
                { title: 'File:Castle Rock a.jpg', dist: 10 },
                { title: 'File:Castle Rock b.jpg', dist: 20 },
              ],
            },
          }
        : pages({
            'File:Castle Rock a.jpg': undefined,
            'File:Castle Rock b.jpg': info('https://u.org/b'),
          }),
    );
    expect((await findCoverImage(PLACE))?.url).toBe('https://u.org/b/1280px');
  });

  const nearbyArticle = {
    query: {
      pages: [
        {
          title: 'Castle Rock State Park (California)',
          index: 1,
          pageimage: 'Castle_Rock_SP.jpg',
          coordinates: [{ lat: 37.2316, lon: -122.1169 }],
        },
      ],
    },
  };

  it('empty geosearch → Wikipedia page image of a nearby matching article', async () => {
    const calls = stubFetch((p, host) => {
      if (p.get('list') === 'geosearch') return { query: { geosearch: [] } };
      if (host === WIKIPEDIA) return nearbyArticle;
      return pages({ 'File:Castle Rock SP.jpg': info('https://u.org/sp') });
    });
    expect(await findCoverImage(PLACE)).toEqual({
      url: 'https://u.org/sp/1280px',
      credit: 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons',
    });
    // No imageinfo call for an empty candidate list.
    expect(calls.map((c) => c.url.host)).toEqual([COMMONS, WIKIPEDIA, COMMONS]);
    expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({
      format: 'json',
      formatversion: '2',
      action: 'query',
      generator: 'search',
      gsrsearch: 'Castle Rock',
      gsrlimit: '5',
      prop: 'pageimages|coordinates',
      piprop: 'name',
      pilicense: 'free',
    });
    expect(calls[2].url.searchParams.get('titles')).toBe('File:Castle Rock SP.jpg');
  });

  it('no usable Commons candidate → Wikipedia fallback', async () => {
    stubFetch((p, host) => {
      if (p.get('list') === 'geosearch') {
        return { query: { geosearch: [{ title: 'File:Castle Rock a.jpg', dist: 10 }] } };
      }
      if (host === WIKIPEDIA) return nearbyArticle;
      return p.get('titles') === 'File:Castle Rock a.jpg'
        ? pages({ 'File:Castle Rock a.jpg': info('https://u.org/a', { mime: 'image/tiff' }) })
        : pages({ 'File:Castle Rock SP.jpg': info('https://u.org/sp') });
    });
    expect((await findCoverImage(PLACE))?.url).toBe('https://u.org/sp/1280px');
  });

  it('an imageinfo response without pages → Wikipedia fallback', async () => {
    stubFetch((p, host) => {
      if (p.get('list') === 'geosearch') {
        return { query: { geosearch: [{ title: 'File:Castle Rock a.jpg', dist: 10 }] } };
      }
      if (host === WIKIPEDIA) return nearbyArticle;
      return p.get('titles') === 'File:Castle Rock a.jpg'
        ? {}
        : pages({ 'File:Castle Rock SP.jpg': info('https://u.org/sp') });
    });
    expect((await findCoverImage(PLACE))?.url).toBe('https://u.org/sp/1280px');
  });

  it('rejects the Wikipedia fallback when the article is far away', async () => {
    const calls = stubFetch((p, host) => {
      if (host === WIKIPEDIA) {
        return {
          query: {
            pages: [
              {
                title: 'Castle Rock',
                index: 1,
                pageimage: 'Castle_Rock_Colorado.jpg',
                coordinates: [{ lat: 39.37, lon: -104.86 }],
              },
            ],
          },
        };
      }
      return p.get('list') === 'geosearch' ? {} : pages({});
    });
    expect(await findCoverImage(PLACE)).toBeNull();
    expect(calls.map((c) => c.url.host)).toEqual([COMMONS, WIKIPEDIA]);
  });

  it('no Wikipedia results → null', async () => {
    stubFetch(() => ({}));
    expect(await findCoverImage(PLACE)).toBeNull();
  });

  it('an error status → null, without reading the body', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ query: { geosearch: [{ title: 'File:Castle Rock.jpg', dist: 1 }] } }, false),
    );
    expect(await findCoverImage(PLACE)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('a network error → null', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await findCoverImage(PLACE)).toBeNull();
  });

  it('a non-JSON body → null', async () => {
    stubFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('x')) }),
    );
    expect(await findCoverImage(PLACE)).toBeNull();
  });

  it('non-finite coordinates → null without a request', async () => {
    const calls = stubFetch(() => ({}));
    expect(await findCoverImage({ ...PLACE, lat: Number.NaN })).toBeNull();
    expect(await findCoverImage({ ...PLACE, lng: Number.POSITIVE_INFINITY })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  // A fetch that only settles by rejecting when its signal aborts.
  function hangingFetch(): AbortSignal[] {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
    );
    return signals;
  }

  it('times out after the default deadline → null', async () => {
    vi.useFakeTimers();
    const signals = hangingFetch();
    const result = findCoverImage(PLACE);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);
    expect(await result).toBeNull();
  });

  it('honours a custom timeout', async () => {
    vi.useFakeTimers();
    const signals = hangingFetch();
    const result = findCoverImage(PLACE, { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(signals[0].aborted).toBe(true);
    expect(await result).toBeNull();
  });

  it('clears its deadline timer once done', async () => {
    vi.useFakeTimers();
    stubFetch(() => ({}));
    await findCoverImage(PLACE);
    expect(vi.getTimerCount()).toBe(0);
  });
});
