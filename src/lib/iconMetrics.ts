// How much empty space a Material Symbols glyph leaves inside its box on
// each side, in em (measured at 15 and 18px; the glyphs are symmetric to
// within half a pixel, but for money_off, below). It differs by glyph, from none (forest) to a quarter
// of the box (expand_more), so a pill padded evenly in CSS still looks
// lopsided once an icon starts or ends it. A pill pads evenly and pulls its edge icons
// out by this much (`glyphBleed`), so the visible ink sits at the padding.
export const ICON_SIDE_BEARING: Readonly<Record<string, number>> = {
  add: 0.194,
  category: 0.111,
  check_box: 0.111,
  check_circle: 0.083,
  close: 0.194,
  expand_more: 0.25,
  lightbulb: 0.167,
  location_on: 0.167,
  map: 0.111,
  // Its slash leaves the right side emptier (0.111). This is the left side,
  // where the Free chip, which it starts, is pulled out.
  money_off: 0.056,
  person: 0.167,
  pets: 0.083,
  schedule: 0.083,
  // The category glyphs (CATEGORY_ICON).
  directions_walk: 0.233,
  explore: 0.067,
  forest: 0,
  landscape: 0.033,
  museum: 0.067,
  pedal_bike: 0,
  restaurant: 0.167,
  terrain: 0.033,
  water: 0.067,
};

/** A negative margin pulling `icon` out by its side bearing (0 if unmeasured). */
export function glyphBleed(icon: string): string {
  const em = ICON_SIDE_BEARING[icon] ?? 0;
  return em ? `-${em}em` : '0';
}
