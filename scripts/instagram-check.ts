/**
 * Instagram canary (#6). Reads a few known public reels the way
 * findSharedPlaces does (api/_instagram.ts), so a change to Instagram's pages
 * shows up here, weekly, before someone's share comes back empty.
 *
 * Usage:
 *   node --experimental-strip-types scripts/instagram-check.ts
 *   INSTAGRAM_REPORT=report.md node --experimental-strip-types scripts/instagram-check.ts
 *
 * Fails (exit 1) when the embed page, the steady source, can't be read for a
 * post; when the post page, for the video and geotag, can't be read for any; or
 * when a picture or video can't be fetched from Instagram's servers. A reel
 * that's been taken down fails it too: replace it in CANARY_POSTS.
 */

import { writeFileSync } from 'node:fs';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  fetchMedia,
  parseInstagramUrl,
  readInstagramPost,
  type InstagramPost,
  type ReadSteps,
} from '../api/_instagram.ts';
import { runAsScript } from './run-as-script.ts';

/**
 * Public posts to read, each with a caption: three reels (the first's video
 * is fetched) and a photo post. The first two are geotagged. The last, the
 * first post shared for real, lists nine hikes; its video is served only
 * above the inline limit (17.7 MB), the case findSharedPlaces uploads to
 * Gemini (which needs Gemini's key, so isn't run here).
 */
export const CANARY_POSTS = [
  'https://www.instagram.com/reel/Ddl9QKSv0D7/',
  'https://www.instagram.com/p/Dc1X4T0mPon/',
  'https://www.instagram.com/reel/DXPfcsORBo6/',
  'https://www.instagram.com/reel/DeneiZFxFGB/',
];

export interface CanaryRead {
  url: string;
  post: InstagramPost;
  steps: ReadSteps;
  /** Whether its picture and smallest video were fetched, when it was tried. */
  image?: boolean;
  video?: boolean;
}

const yes = (v: unknown) => (v ? 'yes' : 'no');
const tried = (v: boolean | undefined) => (v === undefined ? '–' : yes(v));

/** What the reads say: the failures, and a Markdown report. */
export function judge(reads: CanaryRead[]): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const r of reads) {
    if (r.steps.embed !== 'ok' || !r.post.caption) {
      failures.push(`${r.url}: the embed page gave no caption (${r.steps.embed})`);
    }
    if (r.image === false) failures.push(`${r.url}: its picture couldn't be fetched`);
    if (r.video === false) failures.push(`${r.url}: its video couldn't be fetched`);
  }
  if (reads.length > 0 && reads.every((r) => r.steps.page !== 'ok')) {
    failures.push('The post page could not be read for any post, so no video or geotag is read');
  }
  const rows = reads.map(
    (r) =>
      `| ${r.url} | ${r.steps.embed} | ${r.steps.page} | ${yes(r.post.caption)} | ` +
      `${r.post.videoUrls?.length ?? 0} | ${yes(r.post.geotag)} | ${tried(r.image)} | ${tried(r.video)} |`,
  );
  const report = [
    '# Instagram canary',
    '',
    failures.length === 0
      ? 'Every post read as findSharedPlaces reads it.'
      : ['Failed:', '', ...failures.map((f) => `- ${f}`)].join('\n'),
    '',
    '| Post | Embed page | Post page | Caption | Videos | Geotag | Picture | Video |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  return { failures, report };
}

/** Reads each post, and fetches the first one's picture and smallest video. */
export async function readAll(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<CanaryRead[]> {
  const reads: CanaryRead[] = [];
  for (const url of urls) {
    const link = parseInstagramUrl(url);
    if (!link) throw new Error(`Not an Instagram post: ${url}`);
    const { post, steps } = await readInstagramPost(link, fetchImpl);
    const read: CanaryRead = { url, post, steps };
    // Media once a run is enough to know Instagram's servers still answer.
    if (reads.length === 0) {
      if (post.imageUrl)
        read.image = (await fetchMedia(post.imageUrl, MAX_IMAGE_BYTES, fetchImpl)) !== null;
      const smallest = post.videoUrls?.[0];
      if (smallest) read.video = (await fetchMedia(smallest, MAX_VIDEO_BYTES, fetchImpl)) !== null;
    }
    reads.push(read);
  }
  return reads;
}

async function main() {
  const { failures, report } = judge(await readAll(CANARY_POSTS));
  console.log(report);
  if (process.env.INSTAGRAM_REPORT) writeFileSync(process.env.INSTAGRAM_REPORT, report);
  if (failures.length > 0) process.exitCode = 1;
}

runAsScript(import.meta.url, main);
