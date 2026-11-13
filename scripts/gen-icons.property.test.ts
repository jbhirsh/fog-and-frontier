import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseIcon, pathOf } from './gen-icons.ts';

// Path data as Google writes it: commands, figures and separators.
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9., -]+$/;
const pathData = fc.stringMatching(/^[MmLlHhVvCcSsQqTtAaZz0-9., -]{1,60}$/);
// A d attribute's value: path data, or anything an attribute can hold,
// markup and entities included.
const dValue = fc.oneof(
  pathData,
  fc.string({ unit: 'binary', maxLength: 20 }).map((s) => s.replaceAll('"', '')),
  fc.constantFrom('', "M1 1Z' onload='x", 'M1<b>2', 'M1&amp;2', 'M0 0Z\n'),
);
// The SVGs Google could plausibly hand over, and a few it couldn't: one of
// several boxes (or none), any number of paths, attributes either side of d.
const svg = fc.record({
  box: fc.constantFrom('0 -960 960 960', '0 0 24 24', '0 -960 960 961', null),
  paths: fc.array(fc.record({ d: dValue, before: fc.boolean(), after: fc.boolean() }), {
    maxLength: 3,
  }),
  prefix: fc.constantFrom('', '<?xml version="1.0"?>\n'),
});

type Svg = typeof svg extends fc.Arbitrary<infer T> ? T : never;

function draw({ box, paths, prefix }: Svg): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" height="24"${box ? ` viewBox="${box}"` : ''} width="24">`;
  const drawn = paths.map(
    (p) => `<path${p.before ? ' fill="none"' : ''} d="${p.d}"${p.after ? ' stroke="#000"' : ''}/>`,
  );
  return `${prefix}${open}${drawn.join('')}</svg>`;
}

describe('pathOf', () => {
  it('reads the path exactly when the SVG has one path, of path data, in the 960-unit box', () => {
    fc.assert(
      fc.property(svg, (parts) => {
        const one = parts.paths.length === 1 ? parts.paths[0].d : null;
        const readable =
          parts.box === '0 -960 960 960' && one !== null && PATH_DATA.test(one) ? one : null;
        expect(pathOf(draw(parts))).toBe(readable);
      }),
      // Enough runs to reach the rare shapes: one path of junk, in the box.
      { numRuns: 1000 },
    );
  });

  it('never throws, and never lets a quote, an angle bracket or an ampersand through', () => {
    fc.assert(
      fc.property(fc.oneof(svg.map(draw), fc.string({ unit: 'binary' })), (text) => {
        const d = pathOf(text);
        if (d !== null) expect(d).not.toMatch(/["'<>&]/);
      }),
    );
  });
});

describe('parseIcon', () => {
  const name = fc.stringMatching(/^[a-z0-9_]{1,12}$/);
  const suffix = fc.constantFrom('', ':fill', ':pin', ':bold', ':', ':FILL', '::pin');

  it('reads a name, alone or with :fill or :pin, as its cuts, and refuses anything else', () => {
    fc.assert(
      fc.property(name, suffix, fc.constantFrom('', 'A', '-', ' ', '/'), (n, s, junk) => {
        const icon = parseIcon(`${junk}${n}${s}`);
        if (junk || !['', ':fill', ':pin'].includes(s)) {
          expect(icon).toBeNull();
          return;
        }
        expect(icon).toEqual({
          name: n,
          cuts: s === ':pin' ? ['pin'] : s === ':fill' ? ['outline', 'fill'] : ['outline'],
        });
      }),
    );
  });

  it('never throws on anything else', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (arg) => {
        const icon = parseIcon(arg);
        if (icon) expect(arg).toMatch(/^[a-z0-9_]+(:fill|:pin)?$/);
      }),
    );
  });
});
