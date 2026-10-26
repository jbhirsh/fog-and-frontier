import { describe, expect, it } from 'vitest';
import { checkCardCopy, copyLength, draftCardCopy, withStoredCardCopy } from './_cardCopy.js';

const LONG_NAME = 'Castle Rock State Park (Saratoga Gap & Ridge Loop)';

describe('copyLength', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(copyLength('abc')).toBe(3);
    expect(copyLength('Año Nuevo')).toBe(9);
    expect(copyLength('🐕 park')).toBe(6);
  });
});

describe('checkCardCopy', () => {
  it('keeps copy that fits, trimmed', () => {
    const a: Record<string, unknown> = {
      cardLine: '  Easy creek loop past a historic mineral spring. ',
      cardName: ' Castle Rock State Park ',
    };
    checkCardCopy(a);
    expect(a).toEqual({
      cardLine: 'Easy creek loop past a historic mineral spring.',
      cardName: 'Castle Rock State Park',
    });
  });

  it('takes copy exactly at the caps', () => {
    const a: Record<string, unknown> = { cardLine: 'x'.repeat(50), cardName: 'y'.repeat(40) };
    checkCardCopy(a);
    expect(a).toEqual({ cardLine: 'x'.repeat(50), cardName: 'y'.repeat(40) });
  });

  it('refuses a line or a name past its cap', () => {
    expect(() => checkCardCopy({ cardLine: 'x'.repeat(51) })).toThrow(
      'cardLine must be at most 50 characters',
    );
    expect(() => checkCardCopy({ cardName: 'y'.repeat(41) })).toThrow(
      'cardName must be at most 40 characters',
    );
  });

  it('counts the cap after trimming', () => {
    const a: Record<string, unknown> = { cardLine: ` ${'x'.repeat(50)} ` };
    checkCardCopy(a);
    expect(a.cardLine).toBe('x'.repeat(50));
  });

  it('clears copy that is only spaces', () => {
    const a: Record<string, unknown> = { cardLine: '   ', cardName: '' };
    checkCardCopy(a);
    expect(a).toEqual({ cardLine: null, cardName: null });
  });

  it('leaves absent and null fields as they are', () => {
    const absent: Record<string, unknown> = { name: 'Lands End' };
    checkCardCopy(absent);
    expect(absent).toEqual({ name: 'Lands End' });
    const cleared: Record<string, unknown> = { cardLine: null, cardName: null };
    checkCardCopy(cleared);
    expect(cleared).toEqual({ cardLine: null, cardName: null });
  });

  it('refuses copy that is not text', () => {
    expect(() => checkCardCopy({ cardLine: 5 })).toThrow('cardLine must be text');
    expect(() => checkCardCopy({ cardName: ['a'] })).toThrow('cardName must be text');
  });
});

describe('withStoredCardCopy', () => {
  const row = JSON.stringify({ id: 'a1', cardLine: 'Stored line.', cardName: 'Stored' });

  it('keeps the stored copy for a field the edit leaves out', () => {
    expect(withStoredCardCopy({ name: 'A' }, row)).toEqual({
      name: 'A',
      cardLine: 'Stored line.',
      cardName: 'Stored',
    });
    expect(withStoredCardCopy({ cardLine: 'New.' }, row)).toEqual({
      cardLine: 'New.',
      cardName: 'Stored',
    });
  });

  it('clears a field the edit sets to null', () => {
    expect(withStoredCardCopy({ cardLine: null, cardName: null }, row)).toEqual({
      cardLine: null,
      cardName: null,
    });
  });

  it('keeps nothing from a row with none, or none to read', () => {
    const none = { cardLine: undefined, cardName: undefined };
    expect(withStoredCardCopy({}, JSON.stringify({ id: 'a1' }))).toEqual(none);
    expect(withStoredCardCopy({}, JSON.stringify({ cardLine: 7, cardName: null }))).toEqual(none);
    expect(withStoredCardCopy({}, undefined)).toEqual(none);
    expect(withStoredCardCopy({}, 'not json')).toEqual(none);
    expect(withStoredCardCopy({}, 'null')).toEqual(none);
  });
});

describe('draftCardCopy', () => {
  it('keeps a line that fits, trimmed', () => {
    expect(
      draftCardCopy({ name: 'Lands End', cardLine: ' Cliffside trail to a ruined bath. ' }),
    ).toEqual({
      cardLine: 'Cliffside trail to a ruined bath.',
      cardName: null,
    });
  });

  it('drops a line past the cap rather than cutting it', () => {
    expect(draftCardCopy({ name: 'Lands End', cardLine: 'x'.repeat(51) }).cardLine).toBeNull();
    expect(draftCardCopy({ name: 'Lands End', cardLine: 'x'.repeat(50) }).cardLine).toBe(
      'x'.repeat(50),
    );
  });

  it('drops copy that is missing, empty or not text', () => {
    expect(draftCardCopy({ name: LONG_NAME })).toEqual({ cardLine: null, cardName: null });
    expect(draftCardCopy({ name: LONG_NAME, cardLine: '  ', cardName: 7 })).toEqual({
      cardLine: null,
      cardName: null,
    });
  });

  it('keeps a card name only for a name too long for a card', () => {
    expect(draftCardCopy({ name: LONG_NAME, cardName: 'Castle Rock State Park' }).cardName).toBe(
      'Castle Rock State Park',
    );
    expect(draftCardCopy({ name: 'x'.repeat(40), cardName: 'Short' }).cardName).toBeNull();
    expect(draftCardCopy({ name: 'x'.repeat(41), cardName: 'Short' }).cardName).toBe('Short');
    expect(draftCardCopy({ cardName: 'Short' }).cardName).toBeNull();
  });

  it('drops a card name past its own cap', () => {
    expect(draftCardCopy({ name: LONG_NAME, cardName: 'y'.repeat(41) }).cardName).toBeNull();
    expect(draftCardCopy({ name: LONG_NAME, cardName: 'y'.repeat(40) }).cardName).toBe(
      'y'.repeat(40),
    );
  });

  it('measures the name trimmed', () => {
    expect(draftCardCopy({ name: ` ${'x'.repeat(40)} `, cardName: 'Short' }).cardName).toBeNull();
  });
});
