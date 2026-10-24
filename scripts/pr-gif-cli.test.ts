import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import {
  GIF_WARN_BYTES,
  USAGE,
  freePort,
  gifNames,
  markdown,
  parseArgs,
  rawUrl,
  remoteBranch,
  repoFromRemote,
  sizeNote,
} from './pr-gif-cli';
import { PRODUCTION } from './pr-gif';

describe('parseArgs', () => {
  it('needs a scenario and a folder, and has defaults for the rest', () => {
    expect(parseArgs(['scripts/gif-scenarios/open-activity.ts', '--dir', '263'])).toEqual({
      scenario: 'scripts/gif-scenarios/open-activity.ts',
      dir: '263',
      sideBySide: false,
      afterOnly: false,
      scale: 2,
      chromium: undefined,
      branch: 'screenshots',
      repo: undefined,
      push: true,
      keep: false,
      production: 'https://fog-and-frontier.vercel.app',
      base: 'origin/main',
      mode: 'test',
      allowMissingPhotos: false,
    });
    expect(PRODUCTION).toBe('https://fog-and-frontier.vercel.app');
  });

  it('takes every option, in any order', () => {
    expect(
      parseArgs([
        '--side-by-side',
        '--dir',
        'review-count',
        '--scale',
        '1',
        '--chromium',
        '/opt/chrome',
        '--branch',
        'pics',
        '--repo',
        'jbhirsh/fog-and-frontier',
        '--no-push',
        '--keep',
        '--production',
        'https://example.com/',
        '--base',
        'origin/release',
        '--mode',
        'production',
        '--allow-missing-photos',
        'flow.ts',
      ]),
    ).toEqual({
      scenario: 'flow.ts',
      dir: 'review-count',
      sideBySide: true,
      afterOnly: false,
      scale: 1,
      chromium: '/opt/chrome',
      branch: 'pics',
      repo: 'jbhirsh/fog-and-frontier',
      push: false,
      keep: true,
      // Without the trailing slash, for the scenario's path to follow.
      production: 'https://example.com',
      base: 'origin/release',
      mode: 'production',
      allowMissingPhotos: true,
    });
  });

  it('takes --after-only for new UI', () => {
    expect(parseArgs(['a.ts', '--dir', '1', '--after-only']).afterOnly).toBe(true);
  });

  it('takes a Chromium from PR_GIF_CHROMIUM, which --chromium overrides', () => {
    expect(parseArgs(['a.ts', '--dir', '1'], { PR_GIF_CHROMIUM: '/env/chrome' }).chromium).toBe(
      '/env/chrome',
    );
    expect(parseArgs(['a.ts', '--dir', '1'], { PR_GIF_CHROMIUM: '' }).chromium).toBeUndefined();
    expect(
      parseArgs(['a.ts', '--dir', '1', '--chromium', '/flag/chrome'], {
        PR_GIF_CHROMIUM: '/env/chrome',
      }).chromium,
    ).toBe('/flag/chrome');
  });

  it.each([
    [[], 'which scenario?'],
    [['a.ts'], '--dir is needed'],
    [['a.ts', '--dir'], '--dir needs a value'],
    [['a.ts', '--dir', '--keep'], '--dir needs a value'],
    [['a.ts', '--dir', '../up'], '--dir is one folder name'],
    [['a.ts', '--dir', 'a/b'], '--dir is one folder name'],
    [['a.ts', 'b.ts', '--dir', '1'], 'one scenario at a time (got a.ts and b.ts)'],
    [['a.ts', '--dir', '1', '--fast'], 'unknown option --fast'],
    [['a.ts', '--dir', '1', '--scale', '0'], '--scale must be a number above 0'],
    [['a.ts', '--dir', '1', '--scale', 'big'], '--scale must be a number above 0'],
    [['a.ts', '--dir', '1', '--repo', 'just-a-name'], '--repo must be owner/name'],
    [['a.ts', '--dir', '1', '--production', 'fog.app'], '--production must be an http(s) URL'],
    [['a.ts', '--dir', '1', '--production', 'ftp://x'], '--production must be an http(s) URL'],
    // The deployment mode's options are gone.
    [['a.ts', '--dir', '1', '--local'], 'unknown option --local'],
    [['a.ts', '--dir', '1', '--after-url', 'https://x.app'], 'unknown option --after-url'],
    [
      ['a.ts', '--dir', '1', '--after-only', '--side-by-side'],
      '--after-only has nothing to put beside it',
    ],
  ])('refuses %j, saying why and how to call it', (argv, why) => {
    expect(() => parseArgs(argv)).toThrow(why);
    expect(() => parseArgs(argv)).toThrow(USAGE);
  });
});

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
    expect(() => repoFromRemote('not a url')).toThrow('pass --repo owner/name');
  });
});

describe('rawUrl', () => {
  it('links a file at one commit', () => {
    expect(rawUrl('o/r', 'abc123', '263/flow-after.gif')).toBe(
      'https://raw.githubusercontent.com/o/r/abc123/263/flow-after.gif',
    );
  });
});

describe('gifNames', () => {
  it('names each GIF after the scenario', () => {
    expect(gifNames('open-activity')).toEqual({
      before: 'open-activity-before.gif',
      after: 'open-activity-after.gif',
      side: 'open-activity-side-by-side.gif',
    });
  });
});

describe('markdown', () => {
  const given = { repo: 'o/r', sha: 'abc123', dir: '263', name: 'flow', before: '`main`' };
  const at = (file: string) => `https://raw.githubusercontent.com/o/r/abc123/263/${file}`;

  it('is a Before/After table, linked by the commit', () => {
    expect(markdown({ ...given, sideBySide: false })).toBe(
      [
        '| Before (`main`) | After |',
        '|---|---|',
        `| <img src="${at('flow-before.gif')}" width="420"> | <img src="${at('flow-after.gif')}" width="420"> |`,
      ].join('\n'),
    );
  });

  it('adds the joined GIF below when there is one, and says what "before" was', () => {
    const text = markdown({ ...given, before: '`release`', sideBySide: true });
    expect(text.split('\n')[0]).toBe('| Before (`release`) | After |');
    expect(text.split('\n').slice(3)).toEqual([
      '',
      `<img src="${at('flow-side-by-side.gif')}" width="840">`,
    ]);
  });
});

describe('markdown, after only', () => {
  it('is the one GIF', () => {
    expect(
      markdown({
        repo: 'o/r',
        sha: 's',
        dir: '9',
        name: 'flow',
        before: '`main`',
        sideBySide: false,
        afterOnly: true,
      }),
    ).toBe(
      [
        '| After |',
        '|---|',
        '| <img src="https://raw.githubusercontent.com/o/r/s/9/flow-after.gif" width="420"> |',
      ].join('\n'),
    );
  });
});

describe('sizeNote', () => {
  it('says how big a GIF is', () => {
    expect(sizeNote('a.gif', 230_366)).toBe('pr-gif: a.gif is 225 KB');
    expect(sizeNote('a.gif', 1024 * 1024 * 1.5)).toBe('pr-gif: a.gif is 1.5 MB');
  });

  it('warns once it’s over 5 MB, which a PR may not show', () => {
    expect(GIF_WARN_BYTES).toBe(5 * 1024 * 1024);
    expect(sizeNote('a.gif', GIF_WARN_BYTES)).toBe('pr-gif: a.gif is 5.0 MB');
    expect(sizeNote('a.gif', GIF_WARN_BYTES + 1)).toBe(
      'pr-gif: a.gif is 5.0 MB, over 5 MB, which a PR may not show: record a shorter flow, or a narrower one (width)',
    );
  });
});

describe('remoteBranch', () => {
  it('names the branch to fetch for an origin/ ref, and nothing for any other', () => {
    expect(remoteBranch('origin/main')).toBe('main');
    expect(remoteBranch('origin/feature/x')).toBe('feature/x');
    expect(remoteBranch('main')).toBeNull();
    expect(remoteBranch('abc123')).toBeNull();
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
