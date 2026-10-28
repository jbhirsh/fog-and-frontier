import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The theme names its spacing (`--spacing-md: 24px`, `--spacing-xl: 80px`,
// in src/index.css), and Tailwind resolves a width utility against spacing
// before its container sizes: `max-w-xl` is 80px here, not 36rem. A width
// spelled with a name both scales share is that trap (the place's page and
// the Filters sheet once collapsed to a sliver by it), so none may be; say
// the width (`max-w-144`, 36rem) instead.

// Tailwind's container sizes, the names a width utility might mean.
const CONTAINER_SIZES = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl'];

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const spacing = [...css.matchAll(/--spacing-([\w-]+):/g)].map((m) => m[1]);
const shared = CONTAINER_SIZES.filter((size) => spacing.includes(size));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'gql' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('widths, against the theme’s named spacing', () => {
  it('finds the names the two scales share', () => {
    expect(shared).toEqual(expect.arrayContaining(['sm', 'md', 'lg', 'xl']));
  });

  it('spells no width with one of them', () => {
    const found = sources(join(process.cwd(), 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?<![\w-])(?:min-w|max-w|w)-([\w]+)(?![\w-])/g)]
        .filter((m) => shared.includes(m[1]))
        .map((m) => `${file}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });
});
