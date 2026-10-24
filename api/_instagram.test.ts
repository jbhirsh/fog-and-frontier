import { describe, expect, it, vi } from 'vitest';
import {
  EMBED_HEADERS,
  PAGE_HEADERS,
  SOURCE_TIMEOUT_MS,
  cookiesFrom,
  fetchMedia,
  findInstagramUrl,
  isInstagramMedia,
  mergePosts,
  parseEmbedPage,
  parseInstagramUrl,
  parsePostPage,
  readInstagramPost,
  type InstagramLink,
} from './_instagram.js';

const REEL: InstagramLink = {
  shortcode: 'Ddl9QKSv0D7',
  url: 'https://www.instagram.com/reel/Ddl9QKSv0D7/',
};
const IMAGE = 'https://scontent-ord5-1.cdninstagram.com/v/t51/poster.jpg?oe=6AE1';
const VIDEO = (n: number) => `https://scontent-ord5-1.cdninstagram.com/o1/v/t16/${n}.mp4`;

// An embed page as Instagram serves it: the post is a JSON document held in a
// JS string (contextJSON), inside a larger script.
function embedPage(media: Record<string, unknown> | null): string {
  const context = JSON.stringify({
    context: { type: 'GraphVideo' },
    gql_data: { shortcode_media: media },
  });
  return `<html><script>window.__x = {"contextJSON":${JSON.stringify(context)},"other":1};</script></html>`;
}
const EMBED_MEDIA = {
  __typename: 'GraphVideo',
  shortcode: 'Ddl9QKSv0D7',
  is_video: true,
  display_url: IMAGE,
  video_duration: 11.515,
  accessibility_caption: 'Video by Athi',
  edge_media_to_caption: { edges: [{ node: { text: 'Free weekend fair on Treasure Island' } }] },
  owner: { id: '1', username: 'truly_athi' },
};

// A post page as Instagram serves it to a client that doesn't run JavaScript:
// the post deep inside one of many JSON data blocks.
function postPage(media: Record<string, unknown>, extraBlocks: string[] = []): string {
  const block = JSON.stringify({
    require: [
      ['ScheduledServerJS', 'handle', null, [{ __bbox: { result: { data: { items: [media] } } } }]],
    ],
  });
  return [
    '<html>',
    ...extraBlocks,
    `<script type="application/json" nonce="n" data-sjs>${block}</script>`,
    '</html>',
  ].join('\n');
}
const PAGE_MEDIA = {
  code: 'Ddl9QKSv0D7',
  media_type: 2,
  caption: { text: 'Free weekend fair on Treasure Island' },
  user: { username: 'truly_athi' },
  location: {
    __typename: 'XDTLocationDict',
    pk: 1,
    lat: 37.811,
    lng: -122.25,
    name: 'Treasure Island',
  },
  image_versions2: { candidates: [{ url: IMAGE }] },
  video_versions: [
    { type: 101, url: VIDEO(1) },
    { type: 102, url: VIDEO(2) },
    { type: 103, url: VIDEO(3) },
  ],
  accessibility_caption: 'Video by Athi',
};

describe('parseInstagramUrl', () => {
  it.each([
    ['https://www.instagram.com/reel/Ddl9QKSv0D7/', 'reel'],
    ['https://www.instagram.com/reel/Ddl9QKSv0D7/?igsh=MWQ1ZGUxMzBkMA==', 'reel'],
    ['https://instagram.com/reels/Ddl9QKSv0D7', 'reel'],
    ['https://m.instagram.com/tv/Ddl9QKSv0D7/#x', 'reel'],
    ['http://WWW.INSTAGRAM.COM/p/Ddl9QKSv0D7', 'p'],
    ['https://www.instagram.com/truly_athi/reel/Ddl9QKSv0D7/', 'reel'],
    ['  https://www.instagram.com/p/Ddl9QKSv0D7/  ', 'p'],
  ])('reads %s, cut to the post', (raw, kind) => {
    expect(parseInstagramUrl(raw)).toEqual({
      shortcode: 'Ddl9QKSv0D7',
      url: `https://www.instagram.com/${kind}/Ddl9QKSv0D7/`,
    });
  });

  it.each([
    'https://instagram.com.example.com/p/Ddl9QKSv0D7/',
    'https://example.com/p/Ddl9QKSv0D7/',
    'https://www.instagram.com/stories/someone/123/',
    'https://www.instagram.com/truly_athi/',
    'https://www.instagram.com/p/',
    'https://www.instagram.com/p/abc/',
    'https://www.instagram.com/p/Ddl9Q%20KSv0D7/',
    'https://www.instagram.com/a/b/p/Ddl9QKSv0D7/',
    'ftp://www.instagram.com/p/Ddl9QKSv0D7/',
    'instagram.com/p/Ddl9QKSv0D7/',
    '',
  ])('refuses %j', (raw) => {
    expect(parseInstagramUrl(raw)).toBeNull();
  });
});

describe('findInstagramUrl', () => {
  it('finds the first Instagram post in shared text', () => {
    expect(
      findInstagramUrl(
        'See https://example.com/x and this reel: https://www.instagram.com/reel/Ddl9QKSv0D7/?igsh=a, so good',
      ),
    ).toEqual(REEL);
    expect(findInstagramUrl('https://www.instagram.com/reel/Ddl9QKSv0D7/')).toEqual(REEL);
  });

  it('finds nothing when no link is an Instagram post', () => {
    expect(findInstagramUrl('https://example.com/p/Ddl9QKSv0D7 and some words')).toBeNull();
    expect(findInstagramUrl('just words')).toBeNull();
  });
});

describe('parseEmbedPage', () => {
  it('reads the post the embed page holds', () => {
    expect(parseEmbedPage(embedPage(EMBED_MEDIA), REEL)).toEqual({
      ...REEL,
      caption: 'Free weekend fair on Treasure Island',
      author: 'truly_athi',
      imageUrl: IMAGE,
      isVideo: true,
      durationSeconds: 11.515,
      imageDescription: 'Video by Athi',
      videoUrls: undefined,
    });
  });

  it('keeps a video link when the embed page gives one', () => {
    expect(
      parseEmbedPage(embedPage({ ...EMBED_MEDIA, video_url: VIDEO(9) }), REEL)?.videoUrls,
    ).toEqual([VIDEO(9)]);
  });

  it('leaves out what it lacks or can’t use', () => {
    const post = parseEmbedPage(
      embedPage({
        is_video: 'yes',
        video_duration: Number.NaN,
        display_url: '  ',
        edge_media_to_caption: { edges: [] },
      }),
      REEL,
    );
    expect(post).toEqual({
      ...REEL,
      caption: undefined,
      author: undefined,
      imageUrl: undefined,
      isVideo: undefined,
      durationSeconds: undefined,
      imageDescription: undefined,
      videoUrls: undefined,
    });
  });

  it('finds nothing on a page without the post', () => {
    expect(parseEmbedPage('<html>Sorry, this page isn’t available.</html>', REEL)).toBeNull();
    expect(parseEmbedPage(embedPage(null), REEL)).toBeNull();
    // A string that never ends, and one that isn't JSON.
    expect(parseEmbedPage('<script>{"contextJSON":"{\\"a\\":1', REEL)).toBeNull();
    expect(parseEmbedPage('<script>{"contextJSON":"not json"}', REEL)).toBeNull();
  });
});

describe('parsePostPage', () => {
  it('finds the post among the page’s data blocks, by its shortcode', () => {
    const other = `<script type="application/json">${JSON.stringify({ code: 'SomeOther01', caption: { text: 'no' } })}</script>`;
    const notJson = '<script type="application/json">{not json</script>';
    expect(parsePostPage(postPage(PAGE_MEDIA, [other, notJson]), REEL)).toEqual({
      ...REEL,
      caption: 'Free weekend fair on Treasure Island',
      author: 'truly_athi',
      imageUrl: IMAGE,
      isVideo: true,
      imageDescription: 'Video by Athi',
      // Smallest first.
      videoUrls: [VIDEO(3), VIDEO(2), VIDEO(1)],
      geotag: { name: 'Treasure Island', lat: 37.811, lng: -122.25 },
    });
  });

  it('reads a photo post, and a reel whose video files it doesn’t give', () => {
    const photo = parsePostPage(
      postPage({ code: REEL.shortcode, media_type: 1, caption: null, location: null }),
      REEL,
    );
    expect(photo).toMatchObject({
      caption: undefined,
      isVideo: undefined,
      videoUrls: undefined,
      geotag: undefined,
    });
    const reel = parsePostPage(
      postPage({ code: REEL.shortcode, media_type: 2, caption: { text: 'x' } }),
      REEL,
    );
    expect(reel?.isVideo).toBe(true);
    expect(reel?.videoUrls).toBeUndefined();
  });

  it('keeps a geotag only when it has a name and both coordinates', () => {
    for (const location of [
      { name: 'Treasure Island', lat: 37.8 },
      { lat: 37.8, lng: -122.2 },
      { name: 'Treasure Island', lat: '37.8', lng: -122.2 },
    ]) {
      expect(parsePostPage(postPage({ ...PAGE_MEDIA, location }), REEL)?.geotag).toBeUndefined();
    }
  });

  it('skips video entries without a link', () => {
    const page = postPage({
      ...PAGE_MEDIA,
      video_versions: [{ url: VIDEO(1) }, { type: 2 }, { url: '' }],
    });
    expect(parsePostPage(page, REEL)?.videoUrls).toEqual([VIDEO(1)]);
    expect(
      parsePostPage(postPage({ ...PAGE_MEDIA, video_versions: [] }), REEL)?.videoUrls,
    ).toBeUndefined();
  });

  it('finds nothing on a page without the post', () => {
    expect(parsePostPage('<html>Log in to Instagram</html>', REEL)).toBeNull();
    // Another post, or the right code on something that isn't a post.
    expect(parsePostPage(postPage({ ...PAGE_MEDIA, code: 'SomeOther01' }), REEL)).toBeNull();
    expect(parsePostPage(postPage({ code: REEL.shortcode, title: 'x' }), REEL)).toBeNull();
  });
});

describe('mergePosts', () => {
  const embed = parseEmbedPage(embedPage({ ...EMBED_MEDIA, video_url: VIDEO(9) }), REEL);
  const page = parsePostPage(postPage({ ...PAGE_MEDIA, caption: { text: 'Page caption' } }), REEL);

  it('takes the embed page first and fills its gaps from the post page', () => {
    expect(mergePosts(REEL, embed, page)).toEqual({
      ...REEL,
      caption: 'Free weekend fair on Treasure Island',
      author: 'truly_athi',
      imageUrl: IMAGE,
      isVideo: true,
      durationSeconds: 11.515,
      imageDescription: 'Video by Athi',
      // The page's video files over the embed page's one.
      videoUrls: [VIDEO(3), VIDEO(2), VIDEO(1)],
      geotag: { name: 'Treasure Island', lat: 37.811, lng: -122.25 },
    });
  });

  it('makes do with either, or neither', () => {
    expect(mergePosts(REEL, embed, null).videoUrls).toEqual([VIDEO(9)]);
    expect(mergePosts(REEL, null, page).caption).toBe('Page caption');
    expect(mergePosts(REEL, null, null)).toEqual(REEL);
  });
});

describe('cookiesFrom', () => {
  it('keeps each cookie’s name and value, and nothing else', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'csrftoken=abc; Path=/; Secure');
    headers.append('set-cookie', 'mid=xyz; Max-Age=100');
    headers.append('set-cookie', 'broken');
    expect(cookiesFrom(headers)).toBe('csrftoken=abc; mid=xyz');
    expect(cookiesFrom(new Headers())).toBe('');
  });
});

// A fetch that answers each URL from `routes`, noting what it was asked.
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn((input: string, init?: RequestInit) => {
    const url = input;
    calls.push({ url, init });
    const route = routes[url];
    return route ? Promise.resolve(route(init)) : Promise.reject(new Error(`unexpected ${url}`));
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
function html(
  body: string,
  url = '',
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const r = new Response(body, { status, headers });
  if (url) Object.defineProperty(r, 'url', { value: url });
  return r;
}
const EMBED_URL = 'https://www.instagram.com/p/Ddl9QKSv0D7/embed/captioned/';
const HOME_URL = 'https://www.instagram.com/';

describe('readInstagramPost', () => {
  it('reads both sources at once, the post page with a first visit’s cookies', async () => {
    const { impl, calls } = fakeFetch({
      [EMBED_URL]: () => html(embedPage(EMBED_MEDIA)),
      [HOME_URL]: () => html('', '', 200, { 'set-cookie': 'csrftoken=abc; Path=/' }),
      [REEL.url]: () => html(postPage(PAGE_MEDIA), REEL.url),
    });
    const { post, steps } = await readInstagramPost(REEL, impl);
    expect(steps).toEqual({ embed: 'ok', page: 'ok' });
    expect(post.geotag?.name).toBe('Treasure Island');
    expect(post.durationSeconds).toBe(11.515);
    const embedCall = calls.find((c) => c.url === EMBED_URL);
    expect(embedCall?.init?.headers).toEqual(EMBED_HEADERS);
    expect(calls.find((c) => c.url === HOME_URL)?.init?.headers).toEqual(PAGE_HEADERS);
    expect(calls.find((c) => c.url === REEL.url)?.init?.headers).toEqual({
      ...PAGE_HEADERS,
      cookie: 'csrftoken=abc',
    });
    // Each on a time limit.
    for (const call of calls) expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect(SOURCE_TIMEOUT_MS).toBe(8000);
  });

  it('asks for the post page without cookies when the first visit sets none', async () => {
    const { impl, calls } = fakeFetch({
      [EMBED_URL]: () => html(embedPage(EMBED_MEDIA)),
      [HOME_URL]: () => html(''),
      [REEL.url]: () => html(postPage(PAGE_MEDIA)),
    });
    await readInstagramPost(REEL, impl);
    expect(calls.find((c) => c.url === REEL.url)?.init?.headers).toEqual(PAGE_HEADERS);
  });

  it('says why a source failed, and keeps what the other found', async () => {
    const { impl } = fakeFetch({
      [EMBED_URL]: () => html('gone', '', 404),
      [HOME_URL]: () => html(''),
      [REEL.url]: () =>
        html('<html>Log in</html>', 'https://www.instagram.com/accounts/login/?next=x'),
    });
    expect(await readInstagramPost(REEL, impl)).toEqual({
      post: REEL,
      steps: { embed: 'HTTP 404', page: 'sent to the login page' },
    });
  });

  it('names each other way a source fails', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { impl } = fakeFetch({
      [EMBED_URL]: () => html('<html>nothing here</html>'),
      [HOME_URL]: () => Promise.reject(timeout),
    });
    expect((await readInstagramPost(REEL, impl)).steps).toEqual({
      embed: 'no post on the embed page',
      page: 'timed out',
    });
    const page = fakeFetch({
      // A DOMException that isn't an Error here, named as it is.
      [EMBED_URL]: () => Promise.reject(new DOMException('offline', 'NetworkError')),
      [HOME_URL]: () => html(''),
      [REEL.url]: () => html('<html>shell</html>', REEL.url),
    });
    expect((await readInstagramPost(REEL, page.impl)).steps).toEqual({
      embed: String(new DOMException('offline', 'NetworkError')),
      page: 'no post data on the page',
    });
    const refused = fakeFetch({
      [EMBED_URL]: () => html(embedPage(EMBED_MEDIA)),
      [HOME_URL]: () => html(''),
      [REEL.url]: () => html('', '', 429),
    });
    expect((await readInstagramPost(REEL, refused.impl)).steps.page).toBe('HTTP 429');
  });
});

describe('isInstagramMedia', () => {
  it('takes only https links on Instagram’s media servers', () => {
    expect(isInstagramMedia(IMAGE)).toBe(true);
    expect(isInstagramMedia('https://video.xx.fbcdn.net/v/1.mp4')).toBe(true);
    expect(isInstagramMedia('http://scontent.cdninstagram.com/a.jpg')).toBe(false);
    expect(isInstagramMedia('https://cdninstagram.com.example.com/a.jpg')).toBe(false);
    expect(isInstagramMedia('https://example.com/a.jpg')).toBe(false);
    expect(isInstagramMedia('not a url')).toBe(false);
  });
});

describe('responses left unread', () => {
  // A body that notes being let go of, as one never read must be.
  function tracked(status = 200, headers: Record<string, string> = {}, url = '') {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    const r = new Response(body, { status, headers });
    if (url) Object.defineProperty(r, 'url', { value: url });
    return { r, cancelled: () => cancelled };
  }

  it('lets go of every page it doesn’t read', async () => {
    const embed = tracked(404);
    const home = tracked(200, { 'set-cookie': 'mid=x; Path=/' });
    const page = tracked(200, {}, 'https://www.instagram.com/accounts/login/?next=x');
    const { impl } = fakeFetch({
      [EMBED_URL]: () => embed.r,
      [HOME_URL]: () => home.r,
      [REEL.url]: () => page.r,
    });
    const { steps } = await readInstagramPost(REEL, impl);
    expect(steps).toEqual({ embed: 'HTTP 404', page: 'sent to the login page' });
    expect([embed.cancelled(), home.cancelled(), page.cancelled()]).toEqual([true, true, true]);

    const failed = tracked(500);
    const again = tracked(200);
    await readInstagramPost(
      REEL,
      fakeFetch({
        [EMBED_URL]: () => html(embedPage(EMBED_MEDIA)),
        [HOME_URL]: () => again.r,
        [REEL.url]: () => failed.r,
      }).impl,
    );
    expect([again.cancelled(), failed.cancelled()]).toEqual([true, true]);
  });

  it('lets go of media it won’t keep, before downloading it', async () => {
    for (const [status, headers] of [
      [403, { 'content-type': 'video/mp4' }],
      [200, { 'content-type': 'text/html' }],
      [200, { 'content-type': 'video/mp4', 'content-length': '100' }],
    ] as const) {
      const media = tracked(status, headers);
      expect(await fetchMedia(VIDEO(1), 50, () => Promise.resolve(media.r))).toBeNull();
      expect(media.cancelled()).toBe(true);
    }
  });
});

describe('fetchMedia', () => {
  function stream(chunks: number[], type = 'video/mp4', headers: Record<string, string> = {}) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const n of chunks) controller.enqueue(new Uint8Array(n).fill(1));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-type': type, ...headers } });
  }

  it('reads Instagram media up to its size limit', async () => {
    const impl = vi.fn(() =>
      Promise.resolve(stream([3, 4], 'video/mp4; codecs=avc1')),
    ) as unknown as typeof fetch;
    const media = await fetchMedia(VIDEO(1), 7, impl);
    expect(media?.mimeType).toBe('video/mp4');
    expect(media?.data.length).toBe(7);
    expect(vi.mocked(impl).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('drops a file over the limit, whether it says so or not', async () => {
    const said = vi.fn(() =>
      Promise.resolve(stream([1], 'video/mp4', { 'content-length': '100' })),
    );
    expect(await fetchMedia(VIDEO(1), 50, said as unknown as typeof fetch)).toBeNull();
    const unsaid = vi.fn(() => Promise.resolve(stream([30, 30])));
    expect(await fetchMedia(VIDEO(1), 50, unsaid as unknown as typeof fetch)).toBeNull();
  });

  it('fetches nothing that isn’t Instagram media', async () => {
    const impl = vi.fn();
    expect(
      await fetchMedia('https://example.com/a.mp4', 50, impl as unknown as typeof fetch),
    ).toBeNull();
    expect(impl).not.toHaveBeenCalled();
  });

  it('gives nothing for a failure, an empty answer or something that isn’t a picture or video', async () => {
    const answers = [
      () => Promise.resolve(new Response('no', { status: 403 })),
      () => Promise.resolve(new Response(null, { status: 200 })),
      () => Promise.resolve(stream([2], 'text/html')),
      () => Promise.resolve(stream([2], '')),
      () => Promise.reject(new Error('reset')),
    ];
    for (const answer of answers) {
      expect(await fetchMedia(VIDEO(1), 50, vi.fn(answer) as unknown as typeof fetch)).toBeNull();
    }
    expect(
      await fetchMedia(
        IMAGE,
        50,
        vi.fn(() => Promise.resolve(stream([2], 'image/jpeg'))) as unknown as typeof fetch,
      ),
    ).toMatchObject({ mimeType: 'image/jpeg' });
  });
});

// Edges each parser has to get right, which the tests above don't reach.
describe('reading what’s missing or odd', () => {
  it('finds an http link in shared text too', () => {
    expect(findInstagramUrl('see http://instagram.com/p/Ddl9QKSv0D7 now')?.shortcode).toBe(
      'Ddl9QKSv0D7',
    );
  });

  it('reads an embed page whose data opens it, and a caption with quotes in it', () => {
    const context = JSON.stringify({
      gql_data: {
        shortcode_media: {
          display_url: IMAGE,
          edge_media_to_caption: { edges: [{ node: { text: 'Say "hi" \\ bye' } }] },
        },
      },
    });
    const html = `"contextJSON":${JSON.stringify(context)}`;
    expect(parseEmbedPage(html, REEL)?.caption).toBe('Say "hi" \\ bye');
    // A literal that never closes is no post.
    expect(parseEmbedPage(html.slice(0, -1), REEL)).toBeNull();
  });

  it('ignores post-like data on a page with no contextJSON', () => {
    const inner = JSON.stringify({ gql_data: { shortcode_media: { display_url: IMAGE } } });
    // Where the literal would start, were the key found at -1.
    expect(parseEmbedPage(`${'x'.repeat(14)}${JSON.stringify(inner).slice(1)}`, REEL)).toBeNull();
  });

  it('reads an embed post without a caption, or with an empty one', () => {
    for (const edge of [undefined, {}, { edges: [] }, { edges: [{}] }]) {
      const post = parseEmbedPage(
        embedPage({ display_url: IMAGE, edge_media_to_caption: edge }),
        REEL,
      );
      expect(post?.imageUrl).toBe(IMAGE);
      expect(post?.caption).toBeUndefined();
    }
    expect(
      parseEmbedPage(embedPage('gone' as unknown as Record<string, unknown>), REEL),
    ).toBeNull();
  });

  it('keeps the first post with the shortcode on a page', () => {
    const later = { ...PAGE_MEDIA, caption: { text: 'a repost' } };
    const page = postPage({ ...PAGE_MEDIA, caption: { text: 'the post' } }).replace(
      '</html>',
      `<script type="application/json">${JSON.stringify({ items: [later] })}</script></html>`,
    );
    expect(parsePostPage(page, REEL)?.caption).toBe('the post');
    const twice = postPage({
      list: [
        { ...PAGE_MEDIA, caption: { text: 'first' } },
        { ...PAGE_MEDIA, caption: { text: 'second' } },
      ],
    });
    expect(parsePostPage(twice, REEL)?.caption).toBe('first');
  });

  it('reads a page post without pictures, and a video it doesn’t type', () => {
    const post = parsePostPage(
      postPage({
        code: 'Ddl9QKSv0D7',
        caption: null,
        image_versions2: { candidates: [] },
        video_versions: [{ url: 'https://scontent.cdninstagram.com/v.mp4' }],
      }),
      REEL,
    );
    expect(post?.imageUrl).toBeUndefined();
    expect(post?.isVideo).toBe(true);
  });

  it('lets an embed page’s gap be filled, never emptied', () => {
    const merged = mergePosts(
      REEL,
      { ...REEL, caption: undefined, author: 'embed' },
      { ...REEL, caption: 'from the page', author: 'page' },
    );
    expect(merged).toMatchObject({ caption: 'from the page', author: 'embed' });
  });

  it('sends each source the headers it answers to', () => {
    expect(EMBED_HEADERS).toEqual({
      'user-agent': 'FogAndFrontier/1.0 (+https://fog-and-frontier.vercel.app)',
    });
    expect(PAGE_HEADERS).toEqual({
      'user-agent': 'curl/8.5.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-us,en;q=0.5',
      'sec-fetch-mode': 'navigate',
    });
  });

  it('names a failure that isn’t an error, and an empty failed answer', async () => {
    const { steps } = await readInstagramPost(
      REEL,
      fakeFetch({
        // A broken fetch may reject with anything, null included.
        [EMBED_URL]: () => Promise.reject(JSON.parse('null') as Error),
        [HOME_URL]: () => html(''),
        [REEL.url]: () => new Response(null, { status: 404 }),
      }).impl,
    );
    expect(steps).toEqual({ embed: 'null', page: 'HTTP 404' });
    const { steps: empty } = await readInstagramPost(
      REEL,
      fakeFetch({
        [EMBED_URL]: () => new Response(null, { status: 410 }),
        [HOME_URL]: () => html(''),
        [REEL.url]: () => html(postPage(PAGE_MEDIA), REEL.url),
      }).impl,
    );
    expect(empty.embed).toBe('HTTP 410');
  });

  it('refuses media a redirect took off Instagram’s servers, without downloading it', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    });
    const moved = new Response(body, { headers: { 'content-type': 'video/mp4' } });
    Object.defineProperty(moved, 'url', { value: 'https://evil.example/v.mp4' });
    expect(await fetchMedia(VIDEO(1), 50, () => Promise.resolve(moved))).toBeNull();
    expect(cancelled).toBe(true);
    // A redirect that stays on Instagram's servers is fine.
    const stayed = new Response(new Uint8Array(5), { headers: { 'content-type': 'video/mp4' } });
    Object.defineProperty(stayed, 'url', {
      value: 'https://scontent-lax3-1.cdninstagram.com/v.mp4',
    });
    expect((await fetchMedia(VIDEO(1), 50, () => Promise.resolve(stayed)))?.data.length).toBe(5);
  });

  it('keeps media exactly at the limit, and refuses types that only contain image or video', async () => {
    const exact = new Response(new Uint8Array(50), {
      headers: { 'content-type': 'image/jpeg', 'content-length': '50' },
    });
    expect((await fetchMedia(VIDEO(1), 50, () => Promise.resolve(exact)))?.data.length).toBe(50);
    const odd = new Response(new Uint8Array(5), {
      headers: { 'content-type': 'application/x-video/mp4' },
    });
    expect(await fetchMedia(VIDEO(1), 50, () => Promise.resolve(odd))).toBeNull();
  });
});
