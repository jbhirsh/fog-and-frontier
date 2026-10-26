import { describe, expect, it } from 'vitest';
import { cardCopyProblem, copyLength, needsCardName } from './cardCopy';

describe('copyLength', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(copyLength('Año Nuevo')).toBe(9);
    expect(copyLength('🐕 park')).toBe(6);
  });
});

describe('needsCardName', () => {
  it('asks for one only past 40 characters, trimmed', () => {
    expect(needsCardName('x'.repeat(40))).toBe(false);
    expect(needsCardName(` ${'x'.repeat(40)} `)).toBe(false);
    expect(needsCardName('x'.repeat(41))).toBe(true);
  });
});

describe('cardCopyProblem', () => {
  it('passes copy at or under the caps, or none', () => {
    expect(cardCopyProblem({})).toBeNull();
    expect(cardCopyProblem({ cardLine: 'x'.repeat(50), cardName: 'y'.repeat(40) })).toBeNull();
    expect(cardCopyProblem({ cardLine: ` ${'x'.repeat(50)} ` })).toBeNull();
  });

  it('says which to shorten', () => {
    expect(cardCopyProblem({ cardLine: 'x'.repeat(51) })).toBe(
      'Shorten the card line to 50 characters.',
    );
    expect(cardCopyProblem({ cardName: 'y'.repeat(41) })).toBe(
      'Shorten the card name to 40 characters.',
    );
    expect(cardCopyProblem({ cardLine: 'x'.repeat(51), cardName: 'y'.repeat(41) })).toBe(
      'Shorten the card line to 50 characters.',
    );
  });
});
