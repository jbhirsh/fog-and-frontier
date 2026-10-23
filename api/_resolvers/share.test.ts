import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstagramPost } from '../_instagram.js';

const mocks = vi.hoisted(() => ({
  readInstagramPost: vi.fn(),
  fetchMedia: vi.fn(),
  catalogPlaces: vi.fn(),
  logEvent: vi.fn(),
  logServerError: vi.fn(),
}));

vi.mock('../_instagram.js', async (importActual) => ({
  ...(await importActual<typeof import('../_instagram.js')>()),
  readInstagramPost: mocks.readInstagramPost,
  fetchMedia: mocks.fetchMedia,
}));
vi.mock('./catalog.js', () => ({ catalogPlaces: mocks.catalogPlaces }));
vi.mock('../_log.js', () => ({ logEvent: mocks.logEvent, logServerError: mocks.logServerError }));

const {
  GEMINI_TIMEOUT_MS,
  MAX_CAPTION,
  MAX_HINT,
  MAX_PLACES,
  MEDIA_BUDGET_MS,
  PLACE_SOURCES,
  cleanPlaces,
  markSaved,
  placesPrompt,
  shareMutation,
} = await import('./share.js');
const { ENDPOINT } = await import('./gemini.js');
const { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } = await import('../_instagram.js');

const REEL = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';
const IMAGE = 'https://scontent.cdninstagram.com/poster.jpg';
const VIDEO = 'https://scontent.cdninstagram.com/small.mp4';
const OWNER = { caller: { email: 'owner@example.com', role: 'owner' as const } };
const FRIEND = { caller: { email: 'friend@example.com', role: 'editor' as const } };

const FULL_POST: InstagramPost = {
  shortcode: 'Ddl9QKSv0D7',
  url: REEL,
  caption: 'Waterfall hikes: Cataract Falls and Carson Falls',
  author: 'bayareatrails',
  imageUrl: IMAGE,
  isVideo: true,
  durationSeconds: 42,
  imageDescription: 'Video by Bay Area Trails',
  videoUrls: [VIDEO, 'https://scontent.cdninstagram.com/big.mp4'],
  geotag: { name: 'Marin', lat: 38, lng: -122.6 },
};

const CATARACT = { name: 'Cataract Falls', city: 'Fairfax', lat: 37.9358, lng: -122.6345, detail: 'Best after rain', source: 'caption' };
const CARSON = { name: 'Carson Falls', city: 'Fairfax', lat: 37.9843, lng: -122.6233, source: 'on_screen' };

function geminiAnswers(body: unknown, init: ResponseInit = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), init),
      ),
    ),
  );
}
const answer = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
function geminiRequest() {
  const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

async function find(args: { url: string; hint?: string | null }, ctx: object = OWNER) {
  return shareMutation.findSharedPlaces(null, args, ctx as never);
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  mocks.readInstagramPost.mockResolvedValue({ post: FULL_POST, steps: { embed: 'ok', page: 'ok' } });
  mocks.fetchMedia.mockImplementation((url: string) =>
    Promise.resolve(
      url === IMAGE
        ? { data: Buffer.from('jpeg'), mimeType: 'image/jpeg' }
        : url === VIDEO
          ? { data: Buffer.from('mp4'), mimeType: 'video/mp4' }
          : null,
    ),
  );
  mocks.catalogPlaces.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('placesPrompt', () => {
  it('tells Gemini everything that was read, and what’s attached', () => {
    expect(placesPrompt(FULL_POST, 'the second one', { image: true, video: true })).toBe(
      [
        `Instagram reel by @bayareatrails: ${REEL}`,
        'Caption:\nWaterfall hikes: Cataract Falls and Carson Falls',
        "Instagram's description of the picture: Video by Bay Area Trails",
        'Geotag (may be imprecise): Marin (38, -122.6)',
        "The user's hint: the second one",
        'Attached: the video and the picture.',
      ].join('\n\n'),
    );
  });

  it('says only what it has', () => {
    expect(placesPrompt({ shortcode: 'x', url: REEL }, '', { image: false, video: false })).toBe(
      `Instagram post: ${REEL}`,
    );
    expect(placesPrompt({ shortcode: 'x', url: REEL }, '', { image: true, video: false })).toBe(
      `Instagram post: ${REEL}\n\nAttached: the picture.`,
    );
  });

  it('cuts a very long caption', () => {
    const prompt = placesPrompt({ shortcode: 'x', url: REEL, caption: 'a'.repeat(MAX_CAPTION + 50) }, '', {
      image: false,
      video: false,
    });
    expect(prompt).toContain(`Caption:\n${'a'.repeat(MAX_CAPTION)}`);
    expect(prompt).not.toContain('a'.repeat(MAX_CAPTION + 1));
  });
});

describe('cleanPlaces', () => {
  it('keeps whole places, reading a made-up source as the caption', () => {
    expect(
      cleanPlaces({
        places: [
          { ...CATARACT, name: '  Cataract Falls  ', detail: '  Best after rain ' },
          { ...CARSON, source: 'tiktok', detail: '   ' },
        ],
      }),
    ).toEqual([
      { name: 'Cataract Falls', city: 'Fairfax', lat: 37.9358, lng: -122.6345, detail: 'Best after rain', source: 'caption' },
      { name: 'Carson Falls', city: 'Fairfax', lat: 37.9843, lng: -122.6233, detail: null, source: 'caption' },
    ]);
    expect(PLACE_SOURCES).toEqual(['caption', 'on_screen', 'spoken', 'geotag', 'picture', 'hint']);
  });

  it('drops a place missing what a draft needs', () => {
    for (const bad of [
      { ...CATARACT, name: ' ' },
      { ...CATARACT, name: 'x'.repeat(121) },
      { ...CATARACT, city: undefined },
      { ...CATARACT, city: 'x'.repeat(81) },
      { ...CATARACT, lat: '37.9' },
      { ...CATARACT, lat: 91 },
      { ...CATARACT, lng: -181 },
      { ...CATARACT, lat: Number.NaN },
      { ...CATARACT, lat: 0, lng: 0 },
      null,
      'Cataract Falls',
    ]) {
      expect(cleanPlaces({ places: [bad] })).toEqual([]);
    }
    // At the edges, and a single zero, are fine.
    expect(cleanPlaces({ places: [{ ...CATARACT, lat: 90, lng: -180 }] })).toHaveLength(1);
    expect(cleanPlaces({ places: [{ ...CATARACT, lat: 0 }] })).toHaveLength(1);
    expect(cleanPlaces({ places: [{ ...CATARACT, lng: 0 }] })).toHaveLength(1);
    expect(cleanPlaces({ places: [{ ...CATARACT, name: 'x'.repeat(120), city: 'y'.repeat(80) }] })).toHaveLength(1);
  });

  it('drops a detail that’s too long, and keeps the place', () => {
    expect(cleanPlaces({ places: [{ ...CATARACT, detail: 'x'.repeat(301) }] })[0].detail).toBeNull();
    expect(cleanPlaces({ places: [{ ...CATARACT, detail: 'x'.repeat(300) }] })[0].detail).toHaveLength(300);
  });

  it('keeps the first of a name given twice, however it’s written', () => {
    const places = cleanPlaces({
      places: [CATARACT, { ...CATARACT, name: 'the cataract falls!', city: 'Mill Valley' }],
    });
    expect(places.map((p) => p.city)).toEqual(['Fairfax']);
    // A name of no Latin words is matched as written.
    expect(cleanPlaces({ places: [{ ...CATARACT, name: '岩' }, { ...CATARACT, name: '岩' }] })).toHaveLength(1);
  });

  it(`keeps at most ${MAX_PLACES}`, () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...CATARACT, name: `Falls ${i}` }));
    expect(cleanPlaces({ places: many })).toHaveLength(MAX_PLACES);
    expect(MAX_PLACES).toBe(10);
  });

  it('gives nothing for an answer that isn’t a list of places', () => {
    expect(cleanPlaces(null)).toEqual([]);
    expect(cleanPlaces({ places: 'none' })).toEqual([]);
    expect(cleanPlaces([CATARACT])).toEqual([]);
  });
});

describe('markSaved', () => {
  it('marks a place the catalog already has, by a high-confidence match only', () => {
    const catalog = [
      { id: 'cataract-falls', name: 'Cataract Falls', city: 'Fairfax', lat: 37.9359, lng: -122.6346 },
      // Shares words and is near, but isn't the same name: possible only.
      { id: 'carson-falls-trail', name: 'Carson Falls Trail', city: 'Fairfax', lat: 37.9843, lng: -122.6233 },
    ];
    const [cataract, carson] = markSaved(cleanPlaces({ places: [CATARACT, CARSON] }), catalog);
    expect(cataract.saved).toMatchObject({ id: 'cataract-falls', confidence: 'high' });
    expect(carson.saved).toBeNull();
  });
});

describe('findSharedPlaces', () => {
  it('finds the places in a shared reel, from all it could read', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [CATARACT, CARSON] })));
    mocks.catalogPlaces.mockResolvedValue([
      { id: 'cataract-falls', name: 'Cataract Falls', city: 'Fairfax', lat: 37.9358, lng: -122.6345 },
    ]);
    const result = await find({ url: `Look! ${REEL}?igsh=abc`, hint: '  the second one ' });
    expect(result.post).toEqual({
      url: REEL,
      author: 'bayareatrails',
      caption: FULL_POST.caption,
      imageUrl: IMAGE,
      isVideo: true,
    });
    expect(result.read).toEqual({ caption: true, video: true, geotag: true });
    expect(result.places.map((p) => [p.name, p.saved?.id ?? null])).toEqual([
      ['Cataract Falls', 'cataract-falls'],
      ['Carson Falls', null],
    ]);
    // The post as read, its picture and its smallest video that fits.
    expect(mocks.readInstagramPost).toHaveBeenCalledWith({ shortcode: 'Ddl9QKSv0D7', url: REEL });
    // Its smallest video that fits, and not the picture, which the video shows.
    expect(mocks.fetchMedia.mock.calls).toEqual([[VIDEO, MAX_VIDEO_BYTES]]);

    const { url, init, body } = geminiRequest();
    expect(url).toBe(`${ENDPOINT}?key=test-key`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GEMINI_TIMEOUT_MS).toBe(120_000);
    // Search, but no URL reading of what a stranger wrote.
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'medium' },
      responseJsonSchema: {
        type: 'object',
        properties: {
          places: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: "The place's proper name" },
                city: { type: 'string', description: 'The city or town it is in or nearest to' },
                lat: { type: 'number' },
                lng: { type: 'number' },
                detail: {
                  type: 'string',
                  description: 'One line, in your own words, on what the post says about it',
                },
                source: { type: 'string', enum: PLACE_SOURCES },
              },
              required: ['name', 'city', 'lat', 'lng', 'source'],
            },
          },
        },
        required: ['places'],
      },
    });
    const parts = (body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts).toEqual([
      { text: placesPrompt(FULL_POST, 'the second one', { image: false, video: true }) },
      { inlineData: { mimeType: 'video/mp4', data: Buffer.from('mp4').toString('base64') } },
    ]);
    expect((body.systemInstruction as { parts: { text: string }[] }).parts[0].text).toContain(
      'at most 10',
    );
    // One log line for the share: what answered.
    expect(mocks.logEvent).toHaveBeenCalledWith('share.places', {
      shortcode: 'Ddl9QKSv0D7',
      embed: 'ok',
      page: 'ok',
      image: 'not needed',
      video: 'ok',
      geotag: true,
      places: 2,
      gemini: 'ok',
    });
  });

  it('sends the picture when no video fits', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [CATARACT] })));
    mocks.fetchMedia.mockImplementation((url: string) =>
      Promise.resolve(url === IMAGE ? { data: Buffer.from('jpeg'), mimeType: 'image/jpeg' } : null),
    );
    const result = await find({ url: REEL });
    expect(result.read.video).toBe(false);
    const parts = (geminiRequest().body.contents as { parts: unknown[] }[])[0].parts;
    expect(parts).toEqual([
      { text: placesPrompt(FULL_POST, '', { image: true, video: false }) },
      { inlineData: { mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') } },
    ]);
    expect(mocks.fetchMedia).toHaveBeenLastCalledWith(IMAGE, MAX_IMAGE_BYTES);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      'share.places',
      expect.objectContaining({ image: 'ok', video: 'failed or too big' }),
    );
  });

  it('tries no more videos once media has taken its time', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [CATARACT] })));
    let clock = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    mocks.fetchMedia.mockImplementation(() => {
      clock += MEDIA_BUDGET_MS;
      return Promise.resolve(null);
    });
    try {
      await find({ url: REEL });
    } finally {
      spy.mockRestore();
    }
    // The first video used it all: no second video, and no picture.
    expect(mocks.fetchMedia).toHaveBeenCalledTimes(1);
    expect(MEDIA_BUDGET_MS).toBe(20_000);
  });

  it('tries the next video when one doesn’t fit, and goes on without any', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [CATARACT] })));
    mocks.fetchMedia.mockResolvedValue(null);
    const result = await find({ url: REEL });
    expect(mocks.fetchMedia).toHaveBeenCalledTimes(3);
    expect(result.read.video).toBe(false);
    const parts = (geminiRequest().body.contents as { parts: unknown[] }[])[0].parts;
    expect(parts).toHaveLength(1);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      'share.places',
      expect.objectContaining({ image: 'failed', video: 'failed or too big' }),
    );
  });

  it('notes a reel whose video Instagram didn’t give, and a photo post', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [CATARACT] })));
    mocks.readInstagramPost.mockResolvedValue({
      post: { ...FULL_POST, videoUrls: undefined, imageUrl: undefined, geotag: undefined },
      steps: { embed: 'ok', page: 'HTTP 429' },
    });
    const result = await find({ url: REEL });
    expect(result.read).toEqual({ caption: true, video: false, geotag: false });
    expect(result.post.imageUrl).toBeNull();
    expect(mocks.logEvent).toHaveBeenCalledWith(
      'share.places',
      expect.objectContaining({ page: 'HTTP 429', image: 'none', video: 'not given', geotag: false }),
    );
    mocks.readInstagramPost.mockResolvedValue({
      post: { ...FULL_POST, videoUrls: undefined, isVideo: false },
      steps: { embed: 'ok', page: 'ok' },
    });
    await find({ url: REEL });
    expect(mocks.logEvent).toHaveBeenLastCalledWith('share.places', expect.objectContaining({ video: 'none' }));
  });

  it('asks Gemini nothing when there’s nothing to go on', async () => {
    geminiAnswers(answer('{}'));
    mocks.readInstagramPost.mockResolvedValue({
      post: { shortcode: 'Ddl9QKSv0D7', url: REEL },
      steps: { embed: 'HTTP 404', page: 'sent to the login page' },
    });
    const result = await find({ url: REEL });
    expect(result).toEqual({
      post: { url: REEL, author: null, caption: null, imageUrl: null, isVideo: null },
      places: [],
      read: { caption: false, video: false, geotag: false },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith('share.places', {
      shortcode: 'Ddl9QKSv0D7',
      embed: 'HTTP 404',
      page: 'sent to the login page',
      image: 'none',
      video: 'none',
      geotag: false,
      places: 0,
      gemini: 'skipped',
    });
  });

  it('asks Gemini with only a hint, when the post couldn’t be read', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [{ ...CATARACT, source: 'hint' }] })));
    mocks.readInstagramPost.mockResolvedValue({
      post: { shortcode: 'Ddl9QKSv0D7', url: REEL },
      steps: { embed: 'timed out', page: 'timed out' },
    });
    const result = await find({ url: REEL, hint: 'Cataract Falls' });
    expect(result.places.map((p) => p.source)).toEqual(['hint']);
  });

  it('goes ahead with just a geotag, or just a picture', async () => {
    geminiAnswers(answer(JSON.stringify({ places: [CATARACT] })));
    mocks.readInstagramPost.mockResolvedValue({
      post: { shortcode: 'Ddl9QKSv0D7', url: REEL, geotag: FULL_POST.geotag },
      steps: { embed: 'ok', page: 'ok' },
    });
    expect((await find({ url: REEL })).places).toHaveLength(1);
    mocks.readInstagramPost.mockResolvedValue({
      post: { shortcode: 'Ddl9QKSv0D7', url: REEL, imageUrl: IMAGE },
      steps: { embed: 'ok', page: 'ok' },
    });
    expect((await find({ url: REEL })).places).toHaveLength(1);
  });

  it('is for owners only, refusing anyone else before reading Instagram', async () => {
    geminiAnswers(answer('{}'));
    await expect(find({ url: REEL }, FRIEND)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    expect(mocks.readInstagramPost).not.toHaveBeenCalled();
    expect(mocks.fetchMedia).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says when Gemini never answered, or timed out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))));
    await expect(find({ url: REEL })).rejects.toMatchObject({
      message: "Couldn't reach Gemini to read the post",
      extensions: { code: 'BAD_GATEWAY' },
    });
    expect(mocks.logEvent).toHaveBeenLastCalledWith('share.places', expect.objectContaining({ gemini: 'unreachable' }));
    expect(mocks.logServerError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'socket hang up' }), {
      route: '/api/graphql',
      method: 'POST',
      status: 502,
    });
    // Only the request's own time limit reads as timed out, in the log.
    for (const [err, gemini] of [
      [new DOMException('timed out', 'TimeoutError'), 'timed out'],
      [new DOMException('aborted', 'AbortError'), 'unreachable'],
      [Object.assign(new Error('x'), { name: 'TimeoutError' }), 'unreachable'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(err)));
      await expect(find({ url: REEL })).rejects.toMatchObject({ extensions: { code: 'BAD_GATEWAY' } });
      expect(mocks.logEvent).toHaveBeenLastCalledWith('share.places', expect.objectContaining({ gemini }));
    }
  });

  it('says when Gemini answered with an error', async () => {
    geminiAnswers(`quota ${'x'.repeat(600)}`, { status: 429 });
    await expect(find({ url: REEL })).rejects.toMatchObject({
      message: "Gemini couldn't read the post",
      extensions: { code: 'BAD_GATEWAY' },
    });
    expect(mocks.logServerError).toHaveBeenLastCalledWith(expect.any(Error), {
      route: '/api/graphql',
      method: 'POST',
      status: 502,
      detail: `quota ${'x'.repeat(494)}`,
    });
    expect(mocks.logEvent).toHaveBeenLastCalledWith('share.places', expect.objectContaining({ gemini: 'HTTP 429' }));
  });

  it('finds no places in an answer it can’t use', async () => {
    for (const body of [answer('not json'), { candidates: [] }, 'not json at all']) {
      geminiAnswers(body);
      const result = await find({ url: REEL });
      expect(result.places).toEqual([]);
      expect(mocks.logEvent).toHaveBeenLastCalledWith('share.places', expect.objectContaining({ places: 0, gemini: 'unusable' }));
    }
  });

  it('refuses what isn’t an Instagram post, and a hint that’s too long', async () => {
    await expect(find({ url: 'https://example.com/p/Ddl9QKSv0D7/' })).rejects.toMatchObject({
      message: "That isn't a link to an Instagram post or reel",
      extensions: { code: 'BAD_USER_INPUT' },
    });
    await expect(find({ url: REEL, hint: 'x'.repeat(MAX_HINT + 1) })).rejects.toMatchObject({
      message: 'hint is too long',
    });
    expect(MAX_HINT).toBe(300);
    expect(mocks.readInstagramPost).not.toHaveBeenCalled();
    // At the limit is fine.
    geminiAnswers(answer(JSON.stringify({ places: [] })));
    await expect(find({ url: REEL, hint: 'x'.repeat(MAX_HINT) })).resolves.toBeDefined();
  });

  it('is for signed-in accounts only', async () => {
    await expect(find({ url: REEL }, { caller: null })).rejects.toMatchObject({
      extensions: { code: 'UNAUTHENTICATED' },
    });
  });

  it('says so when there’s no Gemini key', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(find({ url: REEL })).rejects.toThrow('GEMINI_API_KEY not configured');
  });
});
