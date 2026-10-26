import { CARD_LINE_MAX, CARD_NAME_MAX } from '../../shared/cardCopy';

// A place's card copy (#295): its card line, and for a long name a shorter
// card name, each written to fit its cap (shared/cardCopy.ts) and shown whole
// on a phone's card. The server holds saves to the same caps.

export { CARD_LINE_MAX, CARD_NAME_MAX };

/** How long a card's copy is, as a person counts it: in characters, so an é or an emoji is one. */
export function copyLength(text: string): number {
  return [...text].length;
}

/** Whether a name is too long for a card, so wants a card name. */
export function needsCardName(name: string): boolean {
  return copyLength(name.trim()) > CARD_NAME_MAX;
}

/** Why an activity's card copy can't be saved, or null when it fits. */
export function cardCopyProblem(a: { cardLine?: string; cardName?: string }): string | null {
  if (copyLength((a.cardLine ?? '').trim()) > CARD_LINE_MAX) {
    return `Shorten the card line to ${CARD_LINE_MAX} characters.`;
  }
  if (copyLength((a.cardName ?? '').trim()) > CARD_NAME_MAX) {
    return `Shorten the card name to ${CARD_NAME_MAX} characters.`;
  }
  return null;
}
