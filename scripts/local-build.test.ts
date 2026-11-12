import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, freePort, pngSize, serve, stopServers } from './local-build';

/**
 * A checkout whose node_modules/vite/bin/vite.js is a stand-in: `build`
 * logs its arguments and VERCEL_ENV, and `preview` serves the port it's
 * given (or, with VITE_FAKE=exit, exits; with VITE_FAKE=hang, listens on
 * nothing).
 */
function fakeVite() {
  const root = mkdtempSync(join(tmpdir(), 'local-build-'));
  const bin = join(root, 'node_modules/vite/bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'log.json');
  writeFileSync(
    join(bin, 'vite.js'),
    `const fs = require('node:fs');
const http = require('node:http');
const [command, ...rest] = process.argv.slice(2);
if (command === 'build') {
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: rest, cwd: process.cwd(), env: process.env.VERCEL_ENV }));
} else if (process.env.VITE_FAKE === 'exit') {
  process.exit(4);
} else if (process.env.VITE_FAKE === 'hang') {
  setInterval(() => {}, 1000);
} else {
  const port = Number(rest[rest.indexOf('--port') + 1]);
  http.createServer((_, res) => res.end('ok')).listen(port);
}
`,
  );
  return { root, log };
}

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

describe('build', () => {
  it('runs vite build in the test mode, as Vercel builds production', () => {
    const { root, log } = fakeVite();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    build(root, root, join(root, 'dist'), 'test');
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual({
      args: ['--mode', 'test', '--outDir', join(root, 'dist'), '--emptyOutDir'],
      cwd: root,
      env: 'production',
    });
    vi.restoreAllMocks();
  });
});

describe('serve and stopServers', () => {
  // src/test/setup.ts stubs fetch to fail; these talk only to the stand-in
  // vite.js above, on localhost.
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))));

  it('serves on a free port, resolves once it answers, and stops it', async () => {
    const { root } = fakeVite();
    const servers: ReturnType<typeof spawn>[] = [];
    try {
      const url = await serve(root, root, 'dist', servers);
      expect(url).toMatch(/^http:\/\/localhost:\d+$/);
      expect(await (await fetch(url)).text()).toBe('ok');
    } finally {
      await stopServers(servers);
    }
    expect(servers[0]?.signalCode).toBe('SIGTERM');
    // Stopping one that's already gone is fine.
    await stopServers(servers);
  });

  it('fails when the server exits, or never answers', async () => {
    const { root } = fakeVite();
    const servers: ReturnType<typeof spawn>[] = [];
    vi.stubEnv('VITE_FAKE', 'exit');
    try {
      await expect(serve(root, root, 'dist', servers)).rejects.toThrow(
        'vite preview for dist exited (4)',
      );
      vi.stubEnv('VITE_FAKE', 'hang');
      await expect(serve(root, root, 'dist', servers, 600)).rejects.toThrow(
        "vite preview for dist didn't answer at http://localhost:",
      );
    } finally {
      vi.unstubAllEnvs();
      await stopServers(servers);
    }
  });
});
