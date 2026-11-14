import viteConfigSource from '../../vite.config.ts?raw';

// Reads the coverage globs out of vite.config.ts's source text, for the tests
// that holds another list in step with them (mutationScope).
const coverageBlock = viteConfigSource.split('coverage: {')[1];

function arrayBody(key: 'include' | 'exclude'): string {
  return coverageBlock.split(`${key}: [`)[1].split(']')[0];
}

// The quoted globs in a chunk of the config, with `//` comments dropped first
// (their apostrophes would confuse the match).
function quotedGlobs(body: string): string[] {
  const code = body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// The globs in vite.config.ts's coverage `include` / `exclude` array.
export function coverageGlobs(key: 'include' | 'exclude'): string[] {
  return quotedGlobs(arrayBody(key));
}
