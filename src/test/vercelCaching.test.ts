import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// How Vercel caches what the build ships (#346), held here since vercel.json
// can't carry a comment. Vite names every file in /assets by its contents
// (index-CS4_3lgu.js), so a name never changes what it serves: browsers keep
// those a year and never ask again (`immutable`). Everything else, index.html
// first, keeps Vercel's default of revalidating on each visit, so a deploy
// shows on the next one. The single-page fallback to index.html leaves
// /assets/ out: a chunk an old page asks for after a deploy is a 404, not
// index.html cached for a year under a script's name. That 404 carries the
// year-long header too (Vercel's headers match the path, not the status):
// harmless, as no deploy serves that name again unless it's rolled back to
// the very deploy that had it.

interface VercelConfig {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;

describe('vercel.json caching', () => {
  it('caches only /assets, for a year, as immutable', () => {
    expect(config.headers).toEqual([
      {
        source: '/assets/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]);
  });

  it('sends every other path but the API to index.html, and never an asset', () => {
    const fallback = config.rewrites.find((r) => r.destination === '/index.html');
    expect(fallback?.source).toBe('/((?!api/|assets/).*)');
    // Vercel's sources are path-to-regexp patterns; this one's group is a plain regex.
    const pattern = new RegExp(`^${fallback?.source.slice(1).replace(/^\((.*)\)$/, '$1')}$`);
    expect(pattern.test('trips/abc')).toBe(true);
    expect(pattern.test('')).toBe(true);
    expect(pattern.test('assets/index-CS4_3lgu.js')).toBe(false);
    expect(pattern.test('api/graphql')).toBe(false);
  });
});
