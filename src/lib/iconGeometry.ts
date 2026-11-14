// The geometry of an icon's path (#338), which iconMetrics' tables hold:
// where its ink sits in the 960-unit box (viewBox 0 -960 960 960) and its
// centre of mass. Material Symbols' paths use only M, L, H, V, Q, T and Z
// (absolute and relative); a curve is flattened into short lines, exact to
// well under the thousandth of an em the tables keep. The centre of mass sums
// signed areas, which is right only for a path that winds each hole against
// its outline: the filled pin cuts (PIN_ICONS) do, but the outlined ones
// (ICONS) don't all, so take a centre of mass only from a pin's path. The ink
// box, and so a side bearing, is right for any.

type Point = readonly [number, number];

const BOX = 960;
const STEPS = 16;

/** The path as closed polygons, its curves flattened. Throws on a command it doesn't know. */
function polygons(d: string): Point[][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const out: Point[][] = [];
  let poly: Point[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let ctrl: Point | null = null;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  const quad = (cx: number, cy: number, ex: number, ey: number) => {
    for (let s = 1; s <= STEPS; s++) {
      const t = s / STEPS;
      const u = 1 - t;
      poly.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]);
    }
    ctrl = [cx, cy];
    x = ex;
    y = ey;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        if (poly.length) out.push(poly);
        x = ox + num();
        y = oy + num();
        startX = x;
        startY = y;
        poly = [[x, y]];
        ctrl = null;
        // Further pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        x = ox + num();
        y = oy + num();
        poly.push([x, y]);
        ctrl = null;
        break;
      case 'H':
        x = ox + num();
        poly.push([x, y]);
        ctrl = null;
        break;
      case 'V':
        y = oy + num();
        poly.push([x, y]);
        ctrl = null;
        break;
      case 'Q': {
        const cx = ox + num();
        const cy = oy + num();
        quad(cx, cy, ox + num(), oy + num());
        break;
      }
      case 'T': {
        const [cx, cy]: Point = ctrl ? [2 * x - ctrl[0], 2 * y - ctrl[1]] : [x, y];
        quad(cx, cy, ox + num(), oy + num());
        break;
      }
      case 'Z':
        out.push(poly);
        poly = [];
        x = startX;
        y = startY;
        ctrl = null;
        // A closed shape is followed by a move (Material Symbols' always are).
        if (i < tokens.length && tokens[i].toUpperCase() !== 'M') {
          throw new Error('iconGeometry: no support for drawing on after "Z" without a move');
        }
        break;
      default:
        throw new Error(`iconGeometry: no support for "${cmd}"`);
    }
  }
  if (poly.length) out.push(poly);
  return out;
}

/** The path's ink: its bounding box and its centre of mass, in the 960-unit box. */
export function inkOf(d: string) {
  const polys = polygons(d);
  const xs = polys.flat().map((p) => p[0]);
  const ys = polys.flat().map((p) => p[1]);
  // Signed areas: a hole wound against its outline is taken out by summing
  // (the pin cuts' holes are; see the header for the outlined icons).
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of polys) {
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k];
      const [x1, y1] = poly[(k + 1) % poly.length];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    centreX: cx / (3 * area),
    centreY: cy / (3 * area),
  };
}

const round = (em: number) => Math.round(em * 1000) / 1000 || 0;

/** The empty space the ink leaves at the box's narrower side, in em. */
export function sideBearing(d: string): number {
  const ink = inkOf(d);
  return round(Math.min(ink.minX, BOX - ink.maxX) / BOX);
}

/**
 * Where the ink looks centred, from the middle of the box, in em: three
 * quarters of the way from the middle of its bounding box to its centre of
 * mass, which is where the eye puts it. For a pin's path (PIN_ICONS); see
 * the header.
 */
export function opticalOffset(d: string): { x: number; y: number } {
  const ink = inkOf(d);
  const look = (lo: number, hi: number, centre: number) => {
    const mid = (lo + hi) / 2;
    return mid + 0.75 * (centre - mid);
  };
  return {
    x: round((look(ink.minX, ink.maxX, ink.centreX) - BOX / 2) / BOX),
    y: round((look(ink.minY, ink.maxY, ink.centreY) + BOX / 2) / BOX),
  };
}
