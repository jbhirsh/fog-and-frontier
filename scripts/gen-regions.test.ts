import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, regionRows, renderRegions } from './gen-regions.ts';

afterEach(() => vi.restoreAllMocks());

const countries = [
  { alpha_2: 'US', name: 'United States' },
  { alpha_2: 'HK', name: 'Hong Kong' },
  { alpha_2: 'TW', name: 'Taiwan, Province of China', common_name: 'Taiwan' },
  { alpha_2: 'JP', name: 'Japan' },
];
const subdivisions = [
  { code: 'US-OR', name: 'Oregon' },
  { code: 'US-CA', name: 'California' },
  { code: 'US-WA', name: 'Washington' },
  { code: 'JP-26', name: 'Kyoto' },
  // A second-level subdivision: left out.
  { code: 'JP-26-X', name: 'Somewhere', parent: 'JP-26' },
];

describe('regionRows', () => {
  it("lists each country's first-level subdivisions, and a country with none whole", () => {
    expect(regionRows(countries, subdivisions)).toEqual([
      ['HK', 'Hong Kong', ''],
      ['JP-26', 'Kyoto', 'Japan'],
      ['TW', 'Taiwan', ''],
      ['US-OR', 'Oregon', 'United States'],
      ['US-WA', 'Washington', 'United States'],
    ]);
  });

  it("leaves out California, which the app's own areas divide", () => {
    expect(regionRows(countries, subdivisions).map((r) => r[0])).not.toContain('US-CA');
  });

  it("names a subdivision's country '' when the country isn't listed", () => {
    expect(regionRows([], [{ code: 'XX-1', name: 'Nowhere' }])).toEqual([['XX-1', 'Nowhere', '']]);
  });
});

describe('renderRegions', () => {
  it('writes the rows as a generated, read-only TypeScript list', () => {
    const text = renderRegions([
      ['US-OR', 'Oregon', 'United States'],
      ['CI', "Côte d'Ivoire", ''],
    ]);
    expect(text).toContain("don't\n// edit by hand.");
    expect(text).toContain(
      "export const ISO_REGIONS = [\n  ['US-OR', 'Oregon', 'United States'],\n  ['CI', 'Côte d\\'Ivoire', ''],\n] as const;\n",
    );
  });
});

describe('main', () => {
  it('reads iso-codes from the folder given and writes the regions file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-regions-'));
    writeFileSync(join(dir, 'iso_3166-1.json'), JSON.stringify({ '3166-1': countries }));
    writeFileSync(join(dir, 'iso_3166-2.json'), JSON.stringify({ '3166-2': subdivisions }));
    const out = join(dir, 'isoRegions.ts');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main([dir], out);
    expect(readFileSync(out, 'utf8')).toBe(renderRegions(regionRows(countries, subdivisions)));
    expect(log).toHaveBeenCalledWith('5 regions');
  });

  it('refuses a file without its list, writing nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-regions-'));
    writeFileSync(join(dir, 'iso_3166-1.json'), JSON.stringify({ '3166-1': countries }));
    writeFileSync(join(dir, 'iso_3166-2.json'), '{}');
    const out = join(dir, 'out.ts');
    await expect(main([dir], out)).rejects.toThrow(
      `gen-regions: ${dir}/iso_3166-2.json has no "3166-2" list`,
    );
    expect(existsSync(out)).toBe(false);
  });
});
