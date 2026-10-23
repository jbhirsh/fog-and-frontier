import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstagramPost, ReadSteps } from '../api/_instagram.ts';

const mocks = vi.hoisted(() => ({ readInstagramPost: vi.fn(), fetchMedia: vi.fn() }));
vi.mock('../api/_instagram.ts', async (importActual) => ({
  ...(await importActual<typeof import('../api/_instagram.ts')>()),
  readInstagramPost: mocks.readInstagramPost,
  fetchMedia: mocks.fetchMedia,
}));

const { CANARY_POSTS, judge, readAll } = await import('./instagram-check.ts');
const { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } = await import('../api/_instagram.ts');

const REEL = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';
const PHOTO = 'https://www.instagram.com/p/Dc1X4T0mPon/';
const OK: ReadSteps = { embed: 'ok', page: 'ok' };
const reel: InstagramPost = {
  shortcode: 'Ddl9QKSv0D7',
  url: REEL,
  caption: 'Waterfalls',
  imageUrl: 'https://scontent.cdninstagram.com/poster.jpg',
  isVideo: true,
  videoUrls: ['https://scontent.cdninstagram.com/small.mp4', 'https://scontent.cdninstagram.com/big.mp4'],
  geotag: { name: 'Cataract Falls', lat: 37.9, lng: -122.6 },
};
const photo: InstagramPost = { shortcode: 'Dc1X4T0mPon', url: PHOTO, caption: 'Flowers', isVideo: false };

describe('judge', () => {
  it('passes posts that read as findSharedPlaces reads them, in a table', () => {
    const { failures, report } = judge([
      { url: REEL, post: reel, steps: OK, image: true, video: true },
      { url: PHOTO, post: photo, steps: { embed: 'ok', page: 'timed out' } },
    ]);
    expect(failures).toEqual([]);
    expect(report).toBe(
      [
        '# Instagram canary',
        '',
        'Every post read as findSharedPlaces reads it.',
        '',
        '| Post | Embed page | Post page | Caption | Videos | Geotag | Picture | Video |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        `| ${REEL} | ok | ok | yes | 2 | yes | yes | yes |`,
        `| ${PHOTO} | ok | timed out | yes | 0 | no | – | – |`,
        '',
      ].join('\n'),
    );
  });

  it('fails on an embed page with no caption, and on media not fetched', () => {
    const { failures, report } = judge([
      { url: REEL, post: { ...reel, caption: undefined }, steps: OK, image: false, video: false },
      { url: PHOTO, post: { shortcode: 'Dc1X4T0mPon', url: PHOTO }, steps: { embed: 'HTTP 404', page: 'ok' } },
    ]);
    expect(failures).toEqual([
      `${REEL}: the embed page gave no caption (ok)`,
      `${REEL}: its picture couldn't be fetched`,
      `${REEL}: its video couldn't be fetched`,
      `${PHOTO}: the embed page gave no caption (HTTP 404)`,
    ]);
    expect(report).toContain(`Failed:\n\n- ${REEL}: the embed page gave no caption (ok)\n- `);
    expect(report).toContain(`| ${REEL} | ok | ok | no | 2 | yes | no | no |`);
  });

  it('fails when the post page reads for no post, but not for one', () => {
    const page = (p: string): ReadSteps => ({ embed: 'ok', page: p });
    expect(
      judge([
        { url: REEL, post: reel, steps: page('sent to the login page') },
        { url: PHOTO, post: photo, steps: page('HTTP 429') },
      ]).failures,
    ).toEqual(['The post page could not be read for any post, so no video or geotag is read']);
    expect(
      judge([
        { url: REEL, post: reel, steps: page('sent to the login page') },
        { url: PHOTO, post: photo, steps: OK },
      ]).failures,
    ).toEqual([]);
    expect(judge([]).failures).toEqual([]);
  });
});

describe('readAll', () => {
  beforeEach(() => {
    mocks.readInstagramPost.mockReset();
    mocks.fetchMedia.mockReset();
  });

  it('reads each post, fetching the first one’s picture and smallest video', async () => {
    mocks.readInstagramPost.mockImplementation(({ shortcode }: { shortcode: string }) =>
      Promise.resolve({ post: shortcode === 'Ddl9QKSv0D7' ? reel : photo, steps: OK }),
    );
    mocks.fetchMedia.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('.jpg') ? { data: Buffer.from('x'), mimeType: 'image/jpeg' } : null),
    );
    const fetchImpl = vi.fn<typeof fetch>();
    const reads = await readAll([REEL, PHOTO], fetchImpl);
    expect(reads).toEqual([
      { url: REEL, post: reel, steps: OK, image: true, video: false },
      { url: PHOTO, post: photo, steps: OK },
    ]);
    expect(mocks.readInstagramPost).toHaveBeenCalledWith({ shortcode: 'Ddl9QKSv0D7', url: REEL }, fetchImpl);
    expect(mocks.fetchMedia.mock.calls).toEqual([
      [reel.imageUrl, MAX_IMAGE_BYTES, fetchImpl],
      [reel.videoUrls?.[0], MAX_VIDEO_BYTES, fetchImpl],
    ]);
  });

  it('tries no media a first post doesn’t have', async () => {
    mocks.readInstagramPost.mockResolvedValue({ post: photo, steps: OK });
    expect(await readAll([PHOTO])).toEqual([{ url: PHOTO, post: photo, steps: OK }]);
    expect(mocks.fetchMedia).not.toHaveBeenCalled();
  });

  it('refuses a link that isn’t an Instagram post', async () => {
    await expect(readAll(['https://example.com/reel/x/'])).rejects.toThrow(
      'Not an Instagram post: https://example.com/reel/x/',
    );
  });

  it('reads Instagram posts only', () => {
    expect(CANARY_POSTS).toHaveLength(3);
    for (const url of CANARY_POSTS) expect(url).toMatch(/^https:\/\/www\.instagram\.com\/(p|reel)\/[\w-]+\/$/);
  });
});
