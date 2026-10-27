// How much empty space a Material Symbols glyph leaves inside its box on
// each side, in em (measured at 15 and 18px; the glyphs are symmetric to
// within half a pixel). It differs by glyph, from none (forest) to a quarter
// of the box (expand_more), so a pill padded evenly in CSS still looks
// lopsided once an icon starts or ends it. A pill pads evenly and pulls its edge icons
// out by this much (`glyphBleed`), so the visible ink sits at the padding.
export const ICON_SIDE_BEARING: Readonly<Record<string, number>> = {
  add: 0.194,
  category: 0.111,
  check_box: 0.111,
  check_circle: 0.083,
  close: 0.194,
  expand_less: 0.25,
  expand_more: 0.25,
  lightbulb: 0.167,
  location_on: 0.167,
  map: 0.111,
  payments: 0.042,
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

// Where a Material Symbols glyph looks centred, from the middle of its box,
// in em, for a pin's circle (#291): three-quarters of the way from the
// middle of its ink's box to its ink's centre of mass, which is where the
// eye puts it (a mountain's wide base sits low, the fork and knife's tines
// high). Measured at 18 and 22px; the rest sit within a hundredth of an em.
export const ICON_OPTICAL_OFFSET: Readonly<Record<string, { x: number; y: number }>> = {
  check: { x: 0, y: 0.014 },
  directions_walk: { x: 0, y: 0.015 },
  forest: { x: -0.01, y: 0.023 },
  home: { x: 0, y: 0.027 },
  landscape: { x: 0.012, y: 0.068 },
  museum: { x: 0, y: 0.038 },
  pedal_bike: { x: 0, y: 0.049 },
  restaurant: { x: 0, y: -0.06 },
  terrain: { x: 0.012, y: 0.068 },
  water: { x: 0, y: 0.026 },
};

/** A transform that moves `icon` to where it looks centred ('' if it's there already). */
export function glyphNudge(icon: string): string {
  const off = ICON_OPTICAL_OFFSET[icon];
  return off ? `transform:translate(${-off.x}em,${-off.y}em);` : '';
}
