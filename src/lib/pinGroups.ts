// Grouping the map's pins (#291): pins that would overlap at the current zoom
// become one group, drawn as a count. Pure, in screen pixels, so the map
// projects each pin at its zoom and hands the points here.

/** A pin where the map draws it, in pixels at the current zoom. */
export interface ScreenPin {
  id: string;
  x: number;
  y: number;
}

/** Pins drawn as one: their ids, the first the seed, drawn at the seed's point. */
export interface PinGroup {
  ids: string[];
  x: number;
  y: number;
}

/**
 * How close, in pixels, two pins may be before they group. Every marker
 * reaches less than half this from its point (see MARKER_REACH_PX in
 * mapPins.ts), so markers this far apart never overlap.
 */
export const GROUP_RADIUS_PX = 48;

/**
 * The pins grouped so that no two markers overlap: the pin with the most
 * neighbours within `radius` seeds a group, takes every ungrouped pin within
 * `radius` of it, and draws at its own point; then the next. A later seed is
 * never within `radius` of an earlier one, or it would have been taken, so
 * the groups' points are at least `radius` apart. Ties go to the lower id,
 * so the grouping doesn't depend on the order the pins come in.
 *
 * The pin `firstId` names (home, which must stay where it is) seeds first,
 * so the places beside it join it rather than drawing over it.
 */
export function groupPins(
  pins: readonly ScreenPin[],
  radius = GROUP_RADIUS_PX,
  firstId?: string,
): PinGroup[] {
  const near = (a: ScreenPin, b: ScreenPin) => Math.hypot(a.x - b.x, a.y - b.y) < radius;
  const neighbours = new Map(pins.map((p) => [p, pins.filter((q) => near(p, q)).length]));
  const rank = (p: ScreenPin) => (p.id === firstId ? Infinity : (neighbours.get(p) ?? 0));
  const seeds = [...pins].sort((a, b) => rank(b) - rank(a) || compareIds(a.id, b.id));
  const grouped = new Set<ScreenPin>();
  const groups: PinGroup[] = [];
  for (const seed of seeds) {
    if (grouped.has(seed)) continue;
    const members = seeds.filter((p) => !grouped.has(p) && near(seed, p));
    for (const p of members) grouped.add(p);
    groups.push({ ids: members.map((p) => p.id), x: seed.x, y: seed.y });
  }
  return groups;
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const GROUP_MIN_SIZE = 34;
/** The widest a group's circle draws, under {@link GROUP_RADIUS_PX}. */
export const GROUP_MAX_SIZE = 46;

/** A group's circle, in pixels: wider the more it holds, up to {@link GROUP_MAX_SIZE}. */
export function groupSize(count: number): number {
  const grown = GROUP_MIN_SIZE + 3 * Math.log2(Math.max(count, 2) / 2);
  return Math.min(GROUP_MAX_SIZE, Math.round(grown));
}

/** A place's pin as the map has it: where it is, and whether it's a far dot (#109). */
export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  minor: boolean;
}

/** One marker the map draws: a place, a group of them, or home holding those beside it. */
export interface DrawnPins {
  /** The places it holds, the seed first; none for home alone. */
  ids: string[];
  /** Where it draws: its seed's point. */
  lat: number;
  lng: number;
  /** Home, holding `ids` beside it. */
  home: boolean;
  /** Only far dots (#109), drawn small and muted. */
  minor: boolean;
  /** Whether zooming in as far as the map goes would part it; if not, a tap lists it. */
  splits: boolean;
}

/** Projects a point to pixels at a zoom, as Leaflet's `map.project` does. */
export type Project = (lat: number, lng: number, zoom: number) => { x: number; y: number };

const HOME_ID = '\u0000home';

/**
 * What the map draws at `zoom` (#291): the places that would overlap grouped,
 * home among them seeded first so it stays put, each group noting whether
 * the map's deepest zoom would part it.
 */
export function drawPins(
  pins: readonly MapPin[],
  home: { lat: number; lng: number },
  project: Project,
  zoom: number,
  maxZoom: number,
  radius = GROUP_RADIUS_PX,
): DrawnPins[] {
  const byId = new Map(pins.map((p) => [p.id, p]));
  const at = (z: number) => (p: { id: string; lat: number; lng: number }) => ({
    id: p.id,
    ...project(p.lat, p.lng, z),
  });
  const homePin = { id: HOME_ID, ...home };
  const groups = groupPins([at(zoom)(homePin), ...pins.map(at(zoom))], radius, HOME_ID);
  return groups.map((group) => {
    const isHome = group.ids[0] === HOME_ID;
    const places = group.ids.flatMap((id) => byId.get(id) ?? []);
    const seed = isHome ? homePin : places[0];
    const members = isHome ? [homePin, ...places] : places;
    return {
      ids: places.map((p) => p.id),
      lat: seed.lat,
      lng: seed.lng,
      home: isHome,
      minor: !isHome && places.every((p) => p.minor),
      splits: members.length < 2 || groupPins(members.map(at(maxZoom)), radius).length > 1,
    };
  });
}
