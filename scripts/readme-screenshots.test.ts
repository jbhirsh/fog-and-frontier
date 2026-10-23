import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  CHANGED_RATIO,
  SHOTS,
  SHOTS_DIR,
  diffRatio,
  main,
  prBody,
  shouldReplace,
} from './readme-screenshots';
import { pngSize } from './pr-gif';

/** A solid PNG, with the first `marked` pixels painted black. */
function png(width: number, height: number, marked = 0): Buffer {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const black = i < marked;
    image.data.set(black ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  return PNG.sync.write(image);
}

describe('SHOTS', () => {
  const readme = readFileSync('README.md', 'utf8');

  it('covers every screenshot the README shows, and nothing else', () => {
    const linked = [...readme.matchAll(/docs\/screenshots\/([\w-]+\.png)/g)].map((m) => m[1]);
    expect(SHOTS.map((s) => s.file).sort()).toEqual([...new Set(linked)].sort());
  });

  it('takes each at the size of the file it replaces', () => {
    for (const shot of SHOTS) {
      // The header's size: decoding the whole PNG takes seconds.
      const { width, height } = pngSize(readFileSync(join(SHOTS_DIR, shot.file)));
      expect({ file: shot.file, width, height }).toEqual({
        file: shot.file,
        width: shot.viewport.width * shot.scale,
        height: shot.viewport.height * shot.scale,
      });
    }
  });

  it('signs in as an owner only for Explore, which only owners see (#111)', () => {
    expect(SHOTS.filter((s) => s.owner).map((s) => s.file)).toEqual(['explore.png']);
  });
});

describe('diffRatio', () => {
  it('is zero for the same picture', () => {
    expect(diffRatio(png(10, 10), png(10, 10))).toBe(0);
  });

  it('is the share of pixels that changed', () => {
    expect(diffRatio(png(10, 10), png(10, 10, 25))).toBe(0.25);
  });

  it('counts a different size as a whole change', () => {
    expect(diffRatio(png(10, 10), png(10, 20))).toBe(1);
    expect(diffRatio(png(10, 10), png(20, 10))).toBe(1);
  });
});

describe('shouldReplace', () => {
  it('writes a screenshot that has no file yet', () => {
    expect(shouldReplace(undefined, png(10, 10))).toBe(true);
  });

  it('keeps the file through changes up to the threshold, and replaces it past', () => {
    // 1000 pixels: 5 is exactly 0.5%, 6 is over.
    expect(CHANGED_RATIO).toBe(0.005);
    expect(shouldReplace(png(100, 10), png(100, 10, 5))).toBe(false);
    expect(shouldReplace(png(100, 10), png(100, 10, 6))).toBe(true);
  });
});

describe('prBody', () => {
  const body = prBody({
    repo: 'o/r',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    files: ['map.png', 'explore.png'],
    runUrl: 'https://run/7',
  });

  it('shows each replaced screenshot before and after, linked by commit', () => {
    expect(body).toContain(
      '| `map.png` | <img src="https://raw.githubusercontent.com/o/r/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/docs/screenshots/map.png" width="300"> | <img src="https://raw.githubusercontent.com/o/r/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/docs/screenshots/map.png" width="300"> |',
    );
    expect(body).toContain('`explore.png`');
  });

  it('says where they came from and follows the PR template', () => {
    expect(body).toContain('at aaaaaaa');
    expect(body).toContain('(https://run/7)');
    expect(body).toContain('over 0.5% of the pixels');
    expect(body).toContain('## Visual changes');
    expect(body).toContain('## Validation');
  });

  it('leaves the run out when there is none', () => {
    const local = prBody({
      repo: 'o/r',
      base: 'a'.repeat(40),
      head: 'b'.repeat(40),
      files: ['x.png'],
    });
    expect(local).not.toContain('(http');
  });
});

describe('main', () => {
  it('prints the PR body for pr-body, from the Actions environment', async () => {
    const out: string[] = [];
    const log = console.log;
    console.log = (line: string) => out.push(line);
    try {
      await main(['pr-body', 'a'.repeat(40), 'b'.repeat(40), 'map.png'], {
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '3',
      });
    } finally {
      console.log = log;
    }
    expect(out.join('\n')).toContain('https://raw.githubusercontent.com/o/r/');
    expect(out.join('\n')).toContain('(https://github.com/o/r/actions/runs/3)');
  });

  it('refuses a pr-body without files, and an unknown command', async () => {
    await expect(main(['pr-body', 'a', 'b'], {})).rejects.toThrow('pr-body <base sha>');
    await expect(main(['shoot'], {})).rejects.toThrow('usage');
  });
});
