import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, SHOTS_DIR, main } from './readme-screenshots';
import { pngSize } from './pr-gif';

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

describe('main', () => {
  it('refuses anything but capture into a folder', async () => {
    await expect(main(['capture'])).rejects.toThrow('usage');
    await expect(main(['shoot', 'out'])).rejects.toThrow('usage');
  });
});
