import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// index.html loads Material Symbols with `icon_names`, so Google serves only
// the icons the app draws (about 30 KB) rather than all of them (1.1 MB, the
// largest download on a phone's first open). An icon left out of the list
// draws as its name in text ("hiking"), so the list is every icon name the
// source spells: any word in quotes, or alone between tags or on a JSX text
// line, that is a Material Symbols name. Words that only happen to be icon
// names ("width", "title") cost a glyph each, which is cheap next to a
// missing icon. Google wants the list in alphabetical order.

const root = process.cwd();

const iconNames = new Set(
  readFileSync(join(root, 'src/test/materialSymbolNames.txt'), 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#')),
);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ['gql', 'test'].includes(entry.name) ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function wordsIn(source: string): string[] {
  const quoted = [...source.matchAll(/['"`>]([a-z][a-z0-9_]*)['"`<]/g)].map((m) => m[1]);
  const jsxText = [...source.matchAll(/^\s+([a-z][a-z0-9_]*)\s*$/gm)].map((m) => m[1]);
  return [...quoted, ...jsxText];
}

const spelled = [
  ...new Set(
    sources(join(root, 'src')).flatMap((file) =>
      wordsIn(readFileSync(file, 'utf8')).filter((word) => iconNames.has(word)),
    ),
  ),
].sort();

const html = readFileSync(join(root, 'index.html'), 'utf8');
const fontUrl = html.match(
  /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols[^'"]*/,
)?.[0];
const loaded = new URL(fontUrl ?? 'https://invalid/').searchParams.get('icon_names')?.split(',');

describe('the icon font', () => {
  it('reads the name list', () => {
    expect(iconNames.size).toBeGreaterThan(3000);
    expect(spelled).toEqual(expect.arrayContaining(['chevron_left', 'hiking', 'restaurant']));
  });

  it('loads exactly the icons the source spells, in alphabetical order', () => {
    // On a failure, set index.html's icon_names to the received list.
    expect(loaded?.join(',')).toBe(spelled.join(','));
  });

  it('keeps every axis the app sets', () => {
    expect(fontUrl).toContain('Material+Symbols+Outlined:wght,FILL@100..700,0..1');
  });
});
