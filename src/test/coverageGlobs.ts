import viteConfigSource from '../../vite.config.ts?raw';

// Reads the coverage globs out of vite.config.ts's source text, for the tests
// that hold other lists in step with them (mutationScope, coverageBacklog).
const coverageBlock = viteConfigSource.split('coverage: {')[1];

// The comment line that opens the coverage backlog in the `exclude` array.
// Every exclude after it is a backlog entry.
const BACKLOG_MARKER = '---- Coverage backlog';

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

// The coverage backlog: the excludes after the backlog marker comment.
export function coverageBacklog(): string[] {
  const [, backlog] = arrayBody('exclude').split(BACKLOG_MARKER);
  if (backlog === undefined) {
    throw new Error(
      `vite.config.ts coverage.exclude has no "${BACKLOG_MARKER}" comment`,
    );
  }
  return quotedGlobs(backlog);
}
