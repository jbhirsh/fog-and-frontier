import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { freePort, pngSize, repoFromRemote } from './local-build';

describe('repoFromRemote', () => {
  it.each([
    'https://github.com/jbhirsh/fog-and-frontier',
    'https://github.com/jbhirsh/fog-and-frontier.git',
    'https://github.com/jbhirsh/fog-and-frontier/',
    'git@github.com:jbhirsh/fog-and-frontier.git',
    'http://127.0.0.1:41799/git/jbhirsh/fog-and-frontier',
    '  https://github.com/jbhirsh/fog-and-frontier\n',
  ])('reads owner/name from %s', (url) => {
    expect(repoFromRemote(url)).toBe('jbhirsh/fog-and-frontier');
  });

  it('asks for --repo when it can’t tell', () => {
    expect(() => repoFromRemote('not a url')).toThrow('set REPO_URL');
  });
});

describe('pngSize', () => {
  it('reads a PNG’s width and height from its header', () => {
    const png = (width: number, height: number) => {
      const head = Buffer.alloc(24);
      head.writeUInt32BE(width, 16);
      head.writeUInt32BE(height, 20);
      return head;
    };
    expect(pngSize(png(2200, 1280))).toEqual({ width: 2200, height: 1280 });
    // From a slice of a larger buffer too.
    const inside = Buffer.concat([Buffer.from('xx'), png(10, 20)]).subarray(2);
    expect(pngSize(inside)).toEqual({ width: 10, height: 20 });
  });
});

describe('freePort', () => {
  it('finds a port that can be listened on', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((done, failed) => {
      const server = createServer();
      server.once('error', failed);
      server.listen(port, () => server.close(() => done()));
    });
  });
});
