// A local production build of the app, served by `vite preview`, for
// scripts/readme-screenshots.ts to photograph: built in the test mode (for
// the visual tests' owner and sign-in flags) and as Vercel builds production
// (VERCEL_ENV), so covers ask for the image CDN as they do there. PR GIFs
// build their own the same way (jbhirsh/ci's gif/build.mjs, set up by
// .github/ci.json's `gif.build`).

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** The width and height of a PNG, from its header. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A port nothing is listening on, from the OS. */
export function freePort(): Promise<number> {
  return new Promise((done, failed) => {
    const server = createServer();
    server.once('error', failed);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/**
 * Runs `vite build` in `cwd` into `outDir`, as Vercel builds production
 * (VERCEL_ENV), so covers ask for the image CDN as they do there.
 */
export function build(root: string, cwd: string, outDir: string, mode: string) {
  console.log(`readme-screenshots: building ${cwd} (${mode})`);
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/vite/bin/vite.js'),
      'build',
      '--mode',
      mode,
      '--outDir',
      outDir,
      '--emptyOutDir',
    ],
    {
      cwd,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, VERCEL_ENV: 'production' },
    },
  );
}

/**
 * Serves `outDir` with `vite preview` on a free port, and resolves once it
 * answers. On localhost: tests/visual/helpers.ts's mockApis lets anything
 * that isn't through to the network.
 */
export async function serve(
  root: string,
  cwd: string,
  outDir: string,
  servers: ChildProcess[],
): Promise<string> {
  const port = await freePort();
  const server = spawn(
    process.execPath,
    [
      join(root, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--outDir',
      outDir,
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  servers.push(server);
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (server.exitCode !== null)
      throw new Error(`vite preview for ${outDir} exited (${server.exitCode})`);
    try {
      if ((await fetch(url)).ok) return url;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline)
      throw new Error(`vite preview for ${outDir} didn't answer at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Stops the servers this started, by their PIDs, and waits for them to go. */
export async function stopServers(servers: ChildProcess[]) {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((done) => {
          if (server.exitCode !== null || server.signalCode !== null) return done();
          server.once('exit', () => done());
          server.kill('SIGTERM');
        }),
    ),
  );
}
