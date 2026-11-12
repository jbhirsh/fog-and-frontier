import fc from 'fast-check';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { quote, regionRows } from './gen-regions.ts';

const code = fc.stringMatching(/^[A-Z]{2}$/);

describe('quote', () => {
  it('reads back, as a TypeScript string literal, exactly the text it was given', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        // A single-quoted literal is valid JavaScript: evaluate it.
        const read: unknown = runInNewContext(quote(s));
        expect(read).toBe(s);
      }),
    );
  });
});

describe('regionRows', () => {
  it('lists every first-level subdivision but California once, and only undivided countries', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ alpha_2: code, name: fc.string() }), {
          selector: (c) => c.alpha_2,
        }),
        fc.uniqueArray(
          fc.record({
            code: fc.tuple(code, fc.stringMatching(/^[A-Z0-9]{1,3}$/)).map(([c, s]) => `${c}-${s}`),
            name: fc.string(),
          }),
          { selector: (s) => s.code },
        ),
        (countries, subdivisions) => {
          const rows = regionRows(countries, subdivisions);
          const codes = rows.map((r) => r[0]);
          expect(new Set(codes).size).toBe(codes.length);
          for (const s of subdivisions) {
            expect(codes.includes(s.code)).toBe(s.code !== 'US-CA');
          }
          const divided = new Set(
            subdivisions.filter((s) => s.code !== 'US-CA').map((s) => s.code.split('-')[0]),
          );
          for (const c of countries)
            expect(codes.includes(c.alpha_2)).toBe(!divided.has(c.alpha_2));
        },
      ),
    );
  });
});
