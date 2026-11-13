import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILLED_ICONS, ICONS, PIN_ICONS } from './iconPaths';
import { CATEGORY_ICON } from './mapPins';

// The generated icons (npm run icons:gen) are the ones the app draws. One the
// source doesn't draw is a path every visitor downloads for nothing, so each
// cut is held to where that cut is drawn. A missing icon needs no test: it's
// a type error.

const root = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ['gql', 'test'].includes(entry.name) ? [] : sources(path);
    const isSource = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource && entry.name !== 'iconPaths.ts' ? [path] : [];
  });
}

const files = sources(join(root, 'src')).map((file) => readFileSync(file, 'utf8'));
// Every name in quotes in these files: a name="…", a ternary's 'close', a
// prop's type.
const spelledIn = (texts: string[]) =>
  new Set(
    texts.flatMap((text) => [...text.matchAll(/['"`]([a-z][a-z0-9_]*)['"`]/g)].map((m) => m[1])),
  );
const categories: string[] = Object.values(CATEGORY_ICON);

/** Each name of `list` that isn't among the names drawn. */
const unused = (list: object, drawn: Set<string>) =>
  Object.keys(list).filter((name) => !drawn.has(name));

// On a failure, delete those entries from src/lib/iconPaths.ts and run
// npm run icons:gen.
describe('the generated icons', () => {
  it('outline only icons an <Icon> draws, in a file that draws one or as a category’s', () => {
    const drawn = spelledIn(files.filter((text) => text.includes('<Icon')));
    expect(unused(ICONS, new Set([...drawn, ...categories]))).toEqual([]);
  });

  it('fill only icons a filled <Icon> draws', () => {
    const drawn = spelledIn(files.filter((text) => /<Icon\b[^>]*?\sfill\b/s.test(text)));
    expect(unused(FILLED_ICONS, drawn)).toEqual([]);
  });

  it('cut pins only for the categories and the pins’ own glyphs', () => {
    const glyphs = files.flatMap((text) =>
      [...text.matchAll(/\bicon: '([a-z0-9_]+)'/g)].map((m) => m[1]),
    );
    expect(unused(PIN_ICONS, new Set([...categories, ...glyphs]))).toEqual([]);
  });

  it('draw every filled icon outlined too, for when it isn’t filled', () => {
    for (const name of Object.keys(FILLED_ICONS)) expect(Object.keys(ICONS)).toContain(name);
  });
});
