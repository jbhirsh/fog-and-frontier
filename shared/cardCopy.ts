// What a place's card shows under its photo on a phone (#295), written to
// fit rather than cut off: no card ends a name or a line with an ellipsis.
// Shared by the app (the form's counters) and the API (the check on save,
// and the cap a draft is held to), which can't import each other.

/** A card's line, at most two lines at a phone card's width. */
export const CARD_LINE_MAX = 50;

/** A shorter name for cards and pins, for a name that would take three lines. */
export const CARD_NAME_MAX = 40;
