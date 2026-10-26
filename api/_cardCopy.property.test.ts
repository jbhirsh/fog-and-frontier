import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CARD_LINE_MAX, CARD_NAME_MAX } from '../shared/cardCopy.js';
import { checkCardCopy, copyLength, draftCardCopy } from './_cardCopy.js';

// Card copy arrives from people (a save, a suggestion) and from a model (a
// draft), and a card shows it whole (#295), so nothing past a cap may get
// through, whatever is sent. Example tests are in _cardCopy.test.ts.

const text = fc.oneof(fc.string({ maxLength: 80 }), fc.string({ unit: 'grapheme', maxLength: 80 }));
const value = fc.oneof(text, fc.constant(null), fc.constant(undefined), fc.anything());

describe('card copy, for anything sent (#295)', () => {
  it('saves only copy within its cap, or refuses it', () => {
    fc.assert(
      fc.property(value, value, (cardLine, cardName) => {
        const a: Record<string, unknown> = { cardLine, cardName };
        try {
          checkCardCopy(a);
        } catch {
          return;
        }
        if (typeof a.cardLine === 'string') {
          expect(copyLength(a.cardLine)).toBeLessThanOrEqual(CARD_LINE_MAX);
          expect(a.cardLine).toBe(a.cardLine.trim());
          expect(a.cardLine).not.toBe('');
        }
        if (typeof a.cardName === 'string') {
          expect(copyLength(a.cardName)).toBeLessThanOrEqual(CARD_NAME_MAX);
        }
      }),
    );
  });

  it('drafts only copy within its cap, and never throws', () => {
    fc.assert(
      fc.property(value, value, value, (name, cardLine, cardName) => {
        const out = draftCardCopy({ name, cardLine, cardName });
        if (out.cardLine !== null)
          expect(copyLength(out.cardLine)).toBeLessThanOrEqual(CARD_LINE_MAX);
        if (out.cardName !== null) {
          expect(copyLength(out.cardName)).toBeLessThanOrEqual(CARD_NAME_MAX);
          expect(typeof name === 'string' && copyLength(name.trim()) > CARD_NAME_MAX).toBe(true);
        }
      }),
    );
  });
});
