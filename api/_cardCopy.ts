import { CARD_LINE_MAX, CARD_NAME_MAX } from '../shared/cardCopy.js';
import { badInput } from './_gqlError.js';

// A place's card copy (#295): its card line and, for a long name, a shorter
// card name, each held to its cap in shared/cardCopy.ts. Copy that doesn't
// fit is refused or dropped, never cut short.

/** How long a card's copy is, as a person counts it: in characters, so an é or an emoji is one. */
export function copyLength(text: string): number {
  return [...text].length;
}

/** An activity's input or draft, which may carry card copy (`cardLine`, `cardName`). */
type CardCopy = Record<string, unknown>;

// One field as saved: trimmed, empty as none, and refused past its cap.
// Absent or null stays as it is.
function checked(value: unknown, max: number, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw badInput(`${field} must be text`);
  const text = value.trim();
  if (copyLength(text) > max) throw badInput(`${field} must be at most ${max} characters`);
  return text || null;
}

/**
 * Holds an activity's input to the card caps before it's saved or suggested:
 * each field trimmed, an empty one cleared, and one past its cap refused.
 */
export function checkCardCopy(activity: CardCopy): void {
  if ('cardLine' in activity) {
    activity.cardLine = checked(activity.cardLine, CARD_LINE_MAX, 'cardLine');
  }
  if ('cardName' in activity) {
    activity.cardName = checked(activity.cardName, CARD_NAME_MAX, 'cardName');
  }
}

/**
 * An edit's card copy, keeping the stored row's (`j`) for a field the input
 * leaves out, as a client from before the fields does; null still clears it.
 */
export function withStoredCardCopy<T extends CardCopy>(activity: T, j: unknown): T {
  let stored: CardCopy = {};
  try {
    const parsed: unknown = JSON.parse(j as string);
    if (parsed && typeof parsed === 'object') stored = parsed as CardCopy;
  } catch {
    // No row, or not JSON: nothing to keep.
  }
  const kept = (field: 'cardLine' | 'cardName') =>
    activity[field] !== undefined
      ? activity[field]
      : typeof stored[field] === 'string'
        ? stored[field]
        : undefined;
  return { ...activity, cardLine: kept('cardLine'), cardName: kept('cardName') };
}

// One drafted field: kept if it's text that fits, else dropped, since the
// draft was billed and the form can ask for it.
function fitted(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && copyLength(text) <= max ? text : null;
}

/**
 * Gemini's card copy for a draft, held to the caps: a line that doesn't fit
 * is dropped, and a card name is kept only for a name too long for a card,
 * and only when it's shorter than that name.
 */
export function draftCardCopy(draft: CardCopy): {
  cardLine: string | null;
  cardName: string | null;
} {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  const cardName = fitted(draft.cardName, CARD_NAME_MAX);
  return {
    cardLine: fitted(draft.cardLine, CARD_LINE_MAX),
    cardName: copyLength(name) > CARD_NAME_MAX ? cardName : null,
  };
}
