import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

// The names a person's Google or Apple account hands over, as attributions
// show them: whatever was typed, the result is trimmed, at most 50
// characters by code point, never half an emoji, and (for Apple's whole
// names) a single word.

vi.mock('./_db.js', () => ({ db: () => ({ execute: vi.fn() }) }));
vi.mock('./_auth.js', () => ({ syncUserRow: vi.fn() }));

const { clipName, firstWord } = await import('./_betterAuth.js');

// No half of an emoji (a surrogate without its pair).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const wellFormed = (s: string) => !LONE_SURROGATE.test(s);

// Long names of letters, spaces and emoji, which put an emoji across the
// 50th character often.
const emojiNames = fc
  .array(fc.constantFrom('a', 'é', ' ', '😀', '🏔️', '👩‍👩‍👧'), { maxLength: 80, size: 'max' })
  .map((parts) => parts.join(''));

const names = fc.oneof(
  emojiNames,
  fc.string({ unit: 'grapheme', maxLength: 80 }),
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.constant(undefined),
);

describe('clipName', () => {
  it('is trimmed, at most 50 code points, and well formed', () => {
    fc.assert(
      fc.property(names, (name) => {
        const clipped = clipName(name);
        expect(Array.from(clipped).length).toBeLessThanOrEqual(50);
        expect(clipped).toBe(clipped.trim());
        if (wellFormed(name ?? '')) expect(wellFormed(clipped)).toBe(true);
      }),
    );
  });

  it('keeps a short name as it was, trimmed', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 20 }), (name) => {
        expect(clipName(` ${name} `)).toBe(name.trim());
      }),
    );
  });
});

describe('firstWord', () => {
  it('is one word, from the start of the name', () => {
    fc.assert(
      fc.property(names, (name) => {
        const word = firstWord(name);
        expect(word).not.toMatch(/\s/);
        expect((name ?? '').trim().startsWith(word)).toBe(true);
      }),
    );
  });
});
