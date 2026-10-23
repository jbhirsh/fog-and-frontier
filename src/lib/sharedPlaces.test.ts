import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloClient } from './apolloClient';
import {
  SOURCE_LABEL,
  bareSharedPost,
  sourceLabel,
  draftSeed,
  findSharedPlaces,
  instagramLink,
  postSeed,
  sharedLink,
  type SharedPlace,
  type SharedPost,
} from './sharedPlaces';

afterEach(async () => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  await apolloClient.clearStore();
});

function reply(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const REEL = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';
const POST: SharedPost = {
  url: REEL,
  author: 'bayareatrails',
  caption: 'Waterfalls! https://linktr.ee/x Cataract and Carson',
  imageUrl: null,
  isVideo: true,
};
const PLACE: SharedPlace = {
  name: 'Carson Falls',
  city: 'Fairfax',
  lat: 37.98,
  lng: -122.62,
  detail: 'A short climb to tiered falls',
  source: 'on_screen',
  saved: null,
};

describe('findSharedPlaces', () => {
  it('asks the server for the post’s places, with the hint trimmed', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        reply({
          data: {
            findSharedPlaces: {
              __typename: 'SharedPlacesPayload',
              post: { __typename: 'SharedPost', ...POST },
              places: [
                { __typename: 'SharedPlace', ...PLACE, detail: null, saved: null },
                {
                  __typename: 'SharedPlace',
                  ...PLACE,
                  name: 'Cataract Falls',
                  source: 'caption',
                  saved: {
                    __typename: 'DuplicateMatch',
                    id: 'cataract-falls',
                    name: 'Cataract Falls',
                    city: 'Fairfax',
                    distanceMeters: 12,
                    confidence: 'high',
                  },
                },
              ],
              read: { __typename: 'SharedRead', caption: true, video: false, geotag: true },
            },
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const found = await findSharedPlaces(REEL, '  the second one ');
    expect(found.post).toMatchObject({ url: REEL, author: 'bayareatrails', isVideo: true });
    expect(found.read).toMatchObject({ caption: true, video: false, geotag: true });
    expect(found.places).toEqual([
      { ...PLACE, detail: null, saved: null },
      {
        ...PLACE,
        name: 'Cataract Falls',
        source: 'caption',
        saved: { __typename: 'DuplicateMatch', id: 'cataract-falls', name: 'Cataract Falls', city: 'Fairfax', distanceMeters: 12, confidence: 'high' },
      },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as {
      variables: unknown;
    };
    expect(body.variables).toEqual({ url: REEL, hint: 'the second one' });
  });

  it('sends no hint when there’s none', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reply({ data: { findSharedPlaces: null } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(findSharedPlaces(REEL, '   ')).rejects.toThrow("Couldn't read the post");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as {
      variables: unknown;
    };
    expect(body.variables).toEqual({ url: REEL, hint: null });
    await apolloClient.clearStore();
    await expect(findSharedPlaces(REEL)).rejects.toThrow("Couldn't read the post");
  });
});

describe('findSharedPlaces — this session’s answers', () => {
  const found = (name: string) =>
    reply({
      data: {
        findSharedPlaces: {
          __typename: 'SharedPlacesPayload',
          post: { __typename: 'SharedPost', ...POST },
          places: [{ __typename: 'SharedPlace', ...PLACE, name, saved: null }],
          read: { __typename: 'SharedRead', caption: true, video: true, geotag: false },
        },
      },
    });

  it('answers a post read before, with the same hint, without asking again', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(found('Carson Falls')));
    vi.stubGlobal('fetch', fetchMock);
    const first = await findSharedPlaces(REEL, 'falls');
    await apolloClient.clearStore();
    expect(await findSharedPlaces(REEL, ' falls ')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Another hint, or another post, is asked for.
    await findSharedPlaces(REEL);
    await apolloClient.clearStore();
    await findSharedPlaces('https://www.instagram.com/p/Dc1X4T0mPon/', 'falls');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('asks every time when the browser keeps nothing', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    });
    const fetchMock = vi.fn(() => Promise.resolve(found('Carson Falls')));
    vi.stubGlobal('fetch', fetchMock);
    expect((await findSharedPlaces(REEL)).places[0].name).toBe('Carson Falls');
    await apolloClient.clearStore();
    await findSharedPlaces(REEL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks again when what was kept isn’t readable', async () => {
    sessionStorage.setItem(`shared-places:${REEL}\n`, '{not json');
    const fetchMock = vi.fn(() => Promise.resolve(found('Carson Falls')));
    vi.stubGlobal('fetch', fetchMock);
    expect((await findSharedPlaces(REEL)).places[0].name).toBe('Carson Falls');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('instagramLink', () => {
  it('finds a link to a post or reel, however Instagram writes it', () => {
    for (const link of [
      REEL,
      'https://instagram.com/p/Ddl9QKSv0D7',
      'http://m.instagram.com/reels/Ddl9QKSv0D7/?igsh=abc',
      'https://www.instagram.com/bay.area_trails/reel/Ddl9QKSv0D7/',
      'https://www.instagram.com/tv/Ddl9QKSv0D7/',
    ]) {
      expect(instagramLink(`Look: ${link} !`)).toBe(link.replace(/ .*/, ''));
    }
  });

  it('finds none elsewhere, or in a link that isn’t to a post', () => {
    for (const text of [
      'https://example.com/p/Ddl9QKSv0D7/',
      'https://www.instagram.com/explore/',
      'https://www.instagram.com/bayareatrails/',
      'https://www.instagram.com/p/abc/',
      'https://instagram.com.evil.example/p/Ddl9QKSv0D7/',
      'instagram.com/p/Ddl9QKSv0D7',
    ]) {
      expect(instagramLink(text)).toBeNull();
    }
  });
});

describe('sharedLink', () => {
  it('finds the link a share passed, in url, text or title', () => {
    expect(sharedLink(new URLSearchParams({ url: REEL }))).toBe(REEL);
    expect(sharedLink(new URLSearchParams({ text: `Look at this ${REEL} wow` }))).toBe(REEL);
    expect(sharedLink(new URLSearchParams({ title: `${REEL}` }))).toBe(REEL);
    // url first, then text.
    expect(
      sharedLink(new URLSearchParams({ text: 'https://example.com/a', url: REEL })),
    ).toBe(REEL);
    expect(sharedLink(new URLSearchParams({ url: 'not a link', text: REEL }))).toBe(REEL);
    expect(sharedLink(new URLSearchParams({ url: 'https://evil.example/', text: REEL }))).toBe(REEL);
  });

  it('finds none in a share without a link to a post', () => {
    expect(sharedLink(new URLSearchParams({ url: 'https://evil.example/' }))).toBeNull();
    expect(sharedLink(new URLSearchParams({ text: 'no link here' }))).toBeNull();
    expect(sharedLink(new URLSearchParams())).toBeNull();
  });
});

describe('draftSeed', () => {
  it('drafts a place from its name and city, with the post in the notes', () => {
    expect(draftSeed(PLACE, POST)).toEqual({
      title: 'Carson Falls, Fairfax',
      notes: [
        `From an Instagram reel by @bayareatrails: ${REEL}`,
        'What it says about Carson Falls: A short climb to tiered falls',
        'Caption: Waterfalls!  Cataract and Carson',
      ].join('\n\n'),
    });
  });

  it('says only what it has, and keeps within a draft’s limits', () => {
    const bare: SharedPost = { url: REEL, author: null, caption: null, imageUrl: null, isVideo: false };
    expect(draftSeed({ ...PLACE, detail: null }, bare)).toEqual({
      title: 'Carson Falls, Fairfax',
      notes: `From an Instagram post: ${REEL}`,
    });
    // A caption of nothing but links adds nothing.
    expect(draftSeed({ ...PLACE, detail: null }, { ...bare, caption: 'https://a.example/x http://b.example/y' }).notes).toBe(
      `From an Instagram post: ${REEL}`,
    );
    const long = draftSeed({ ...PLACE, name: 'n'.repeat(250) }, { ...POST, caption: 'c'.repeat(3000) });
    expect(long.title).toHaveLength(200);
    expect(long.notes).toContain(`Caption: ${'c'.repeat(1200)}`);
    expect(long.notes).not.toContain('c'.repeat(1201));
  });
});

describe('sourceLabel', () => {
  it('says an Instagram source is one, and anything else is where it was found', () => {
    expect(sourceLabel(REEL)).toBe('Seen on Instagram');
    expect(sourceLabel('https://example.com/best-hikes')).toBe('Where we found it');
  });
});

describe('bareSharedPost', () => {
  it('knows a post only by its link', () => {
    expect(bareSharedPost(REEL)).toEqual({ url: REEL, author: null, caption: null, imageUrl: null, isVideo: null });
  });
});

describe('postSeed', () => {
  it('starts a by-hand draft with the post in the notes', () => {
    expect(postSeed(POST)).toEqual({ title: '', notes: `From an Instagram reel by @bayareatrails: ${REEL}` });
    expect(postSeed({ ...POST, author: null, isVideo: null }).notes).toBe(`From an Instagram post: ${REEL}`);
  });
});

describe('SOURCE_LABEL', () => {
  it('says where each place was found', () => {
    expect(SOURCE_LABEL).toEqual({
      caption: 'in the caption',
      on_screen: 'on screen',
      spoken: 'said in the video',
      geotag: 'its location tag',
      picture: 'in the picture',
      hint: 'your hint',
    });
  });
});
