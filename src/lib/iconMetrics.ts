import type { IconName, PinIconName } from './iconPaths';

// How much empty space an icon's ink leaves inside its box on its narrower
// side (the two are within a twentieth of an em), in em, from its path in src/lib/iconPaths.ts (iconGeometry's sideBearing,
// which iconMetrics.test.ts holds these to: regenerate the icons and it says
// which to change). It differs by icon, from none (forest) to a quarter of
// the box (expand_more), so a pill padded evenly in CSS still looks lopsided
// once an icon starts or ends it. A pill pads evenly and pulls its edge icons
// out by this much (`glyphBleed`), so the visible ink sits at the padding.
export const ICON_SIDE_BEARING: Readonly<Partial<Record<IconName, number>>> = {
  add: 0.208,
  check_box: 0.125,
  close: 0.216,
  expand_less: 0.25,
  expand_more: 0.25,
  lightbulb: 0.188,
  location_on: 0.167,
  map: 0.125,
  payments: 0.042,
  person: 0.167,
  schedule: 0.083,
  // The category glyphs (CATEGORY_ICON).
  directions_walk: 0.216,
  explore: 0.083,
  forest: 0,
  landscape: 0.042,
  museum: 0.083,
  pedal_bike: 0,
  restaurant: 0.167,
  terrain: 0.042,
  water: 0.083,
};

/** A negative margin pulling `icon` out by its side bearing (0 if it isn't listed). */
export function glyphBleed(icon: IconName): string {
  const em = ICON_SIDE_BEARING[icon] ?? 0;
  return em ? `-${em}em` : '0';
}

// Where a pin's glyph (its filled weight-500 path) looks centred, from the
// middle of its box, in em, for a pin's circle (#291): three-quarters of the
// way from the middle of its ink's box to its ink's centre of mass, which is
// where the eye puts it (a mountain's wide base sits low, the fork and
// knife's tines high). From iconGeometry's opticalOffset, as the bearings
// are; a glyph within half a hundredth of an em of the middle (explore)
// isn't listed.
export const ICON_OPTICAL_OFFSET: Readonly<Partial<Record<PinIconName, { x: number; y: number }>>> =
  {
    check: { x: -0.001, y: 0.017 },
    directions_walk: { x: -0.012, y: 0.008 },
    forest: { x: -0.007, y: 0.019 },
    home: { x: 0, y: 0.026 },
    landscape: { x: 0.011, y: 0.066 },
    museum: { x: 0, y: 0.04 },
    pedal_bike: { x: 0.005, y: 0.058 },
    restaurant: { x: 0.003, y: -0.064 },
    terrain: { x: 0.011, y: 0.066 },
    water: { x: 0, y: 0.023 },
  };

/** A transform that moves `icon` to where it looks centred ('' if it's there already). */
export function glyphNudge(icon: PinIconName): string {
  const off = ICON_OPTICAL_OFFSET[icon];
  return off ? `transform:translate(${-off.x}em,${-off.y}em);` : '';
}
