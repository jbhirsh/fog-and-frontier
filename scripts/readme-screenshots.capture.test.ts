// capture and main with the browser, the build and production faked at
// their modules: what's taken, in what order, and that a shot whose photos
// failed writes nothing. SHOTS themselves are checked against the README in
// readme-screenshots.test.ts.
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachePhotos } from './live-site.ts';
import { SHOTS, capture, main } from './readme-screenshots';

const fakes = vi.hoisted(() => {
  const failed = new Map<string, string>();
  const pages: { calls: string[]; owner: boolean }[] = [];
  const screenshotOptions: unknown[] = [];
  // Takes the context's options, which the test reads from its calls.
  const newContext = vi.fn<(options: unknown) => Promise<{ newPage: () => Promise<unknown> }>>(() =>
    Promise.resolve({ newPage: () => Promise.resolve(page()) }),
  );
  const close = vi.fn(() => Promise.resolve());
  const page = () => {
    const record = { calls: [] as string[], owner: false };
    pages.push(record);
    const step =
      (name: string) =>
      (...args: unknown[]) => {
        record.calls.push(
          args.length && typeof args[0] !== 'function' ? `${name} ${String(args[0])}` : name,
        );
        return Promise.resolve();
      };
    const element = (selector: string) => ({
      first: () => ({ waitFor: step(`wait ${selector}`), click: step(`click ${selector}`) }),
    });
    return {
      locator: element,
      getByRole: (role: string, options?: { name?: string }) => ({
        waitFor: step(options?.name ? `wait role ${role} ${options.name}` : `wait role ${role}`),
      }),
      waitForTimeout: step('pause'),
      goto: step('goto'),
      evaluate: step('evaluate'),
      addInitScript: (script: () => void) => {
        record.owner = true;
        script();
        return Promise.resolve();
      },
      screenshot: (options: unknown) => {
        screenshotOptions.push(options);
        return Promise.resolve(Buffer.from(`png ${pages.length}`));
      },
    };
  };
  return {
    failed,
    pages,
    screenshotOptions,
    newContext,
    close,
    launch: vi.fn(() => Promise.resolve({ newContext, close })),
    build: vi.fn(),
    serve: vi.fn(() => Promise.resolve('http://localhost:4321')),
    stopServers: vi.fn(() => Promise.resolve()),
    mockApis: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('@playwright/test', () => ({ webkit: { launch: fakes.launch } }));
vi.mock('vite', () => ({
  runnerImport: () => Promise.resolve({ module: { mockApis: fakes.mockApis } }),
}));
vi.mock('./local-build.ts', () => ({
  build: fakes.build,
  serve: fakes.serve,
  stopServers: fakes.stopServers,
}));
vi.mock('./live-site.ts', () => ({
  PRODUCTION: 'https://fog-and-frontier.vercel.app',
  liveSite: vi.fn(() => Promise.resolve()),
  cachePhotos: vi.fn(() => Promise.resolve({ failed: fakes.failed })),
  waitForPhotos: vi.fn(() => Promise.resolve()),
  describeFailed: (failed: Map<string, string>) => [...failed.keys()].join(', '),
}));

afterEach(() => {
  fakes.failed.clear();
  fakes.pages.length = 0;
  fakes.screenshotOptions.length = 0;
  vi.clearAllMocks();
  delete (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__;
});

describe('capture', () => {
  it('builds and serves the app once, takes every shot, and writes each under its name', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'shots-')), 'out');
    const taken = await capture(out, '/repo');
    expect(taken).toEqual(SHOTS.map((s) => s.file));
    expect(fakes.build).toHaveBeenCalledTimes(1);
    expect(fakes.build.mock.calls[0]?.slice(0, 2)).toEqual(['/repo', '/repo']);
    expect(fakes.build.mock.calls[0]?.[3]).toBe('test');
    expect(readdirSync(out).sort()).toEqual(SHOTS.map((s) => s.file).sort());
    expect(readFileSync(join(out, SHOTS[0].file), 'utf8')).toBe('png 1');
    expect(fakes.mockApis).toHaveBeenCalledTimes(SHOTS.length);
    expect(fakes.stopServers).toHaveBeenCalledTimes(1);
    expect(fakes.stopServers).toHaveBeenCalledWith([]);
  });

  it('opens each shot at its size in a fresh browser, with service workers off, and closes it', async () => {
    await capture(join(mkdtempSync(join(tmpdir(), 'shots-')), 'out'), '/repo');
    expect(fakes.newContext.mock.calls.map(([options]) => options)).toEqual(
      SHOTS.map((s) => ({
        viewport: s.viewport,
        deviceScaleFactor: s.scale,
        serviceWorkers: 'block',
      })),
    );
    expect(fakes.close).toHaveBeenCalledTimes(SHOTS.length);
    expect(fakes.screenshotOptions).toEqual(
      SHOTS.map(() => ({ animations: 'disabled', caret: 'hide' })),
    );
    expect(cachePhotos).toHaveBeenCalledTimes(SHOTS.length);
    for (const call of vi.mocked(cachePhotos).mock.calls) {
      expect(call[1]).toEqual({ production: 'https://fog-and-frontier.vercel.app' });
    }
  });

  it('makes the folder it writes into, parents included', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'shots-')), 'a', 'b');
    await capture(out, '/repo');
    expect(readdirSync(out)).toHaveLength(SHOTS.length);
  });

  it('opens each page at its path, and waits for what it shows', async () => {
    await capture(join(mkdtempSync(join(tmpdir(), 'shots-')), 'out'), '/repo');
    const byFile = new Map(SHOTS.map((s, i) => [s.file, fakes.pages[i]]));
    expect(byFile.get('map.png')?.calls).toEqual([
      'goto http://localhost:4321/?view=map',
      'evaluate',
      'wait .leaflet-container',
      'wait .leaflet-tile-loaded',
      'pause 1500',
    ]);
    expect(byFile.get('activity-detail.png')?.calls).toContain('click [data-activity-id]');
    expect(byFile.get('activity-detail.png')?.calls).toContain('wait role dialog');
    expect(byFile.get('explore.png')?.calls).toContain('wait role heading Explore');
    expect(byFile.get('mobile-list.png')?.calls).toEqual([
      'goto http://localhost:4321/?view=list',
      'evaluate',
      'wait [data-activity-id]',
    ]);
    expect(byFile.get('home-split.png')?.calls.slice(-1)).toEqual(['pause 1500']);
  });

  it('signs in as an owner only for the shots that need it', async () => {
    await capture(join(mkdtempSync(join(tmpdir(), 'shots-')), 'out'), '/repo');
    expect(fakes.pages.map((p) => p.owner)).toEqual(SHOTS.map((s) => s.owner === true));
    expect((window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__).toBe(true);
  });

  it('writes nothing when a photo fails to load, and still stops the server', async () => {
    fakes.failed.set('https://example.com/cover.jpg', 'HTTP 404');
    const out = join(mkdtempSync(join(tmpdir(), 'shots-')), 'out');
    await expect(capture(out, '/repo')).rejects.toThrow(
      `readme-screenshots: photos didn't load for ${SHOTS[0].file}: https://example.com/cover.jpg`,
    );
    expect(existsSync(out)).toBe(false);
    expect(fakes.stopServers).toHaveBeenCalledTimes(1);
  });
});

describe('main', () => {
  it('captures into the folder given, and says how many it took', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = join(mkdtempSync(join(tmpdir(), 'shots-')), 'out');
    await main(['capture', out]);
    expect(readdirSync(out)).toHaveLength(SHOTS.length);
    expect(error).toHaveBeenCalledWith(`readme-screenshots: took ${SHOTS.length} into ${out}`);
    error.mockRestore();
  });
});
