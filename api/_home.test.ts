import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_BASE } from './_home.js';

describe('HOME_BASE', () => {
  it("is the app's home location, so prompts and distances share one place", () => {
    // Read as text: api/ may not import src/.
    const home = readFileSync(resolve('src/data/home.ts'), 'utf8');
    const label = /\blabel: '([^']+)'/.exec(home)?.[1];
    expect(label).toBe(HOME_BASE);
  });
});
