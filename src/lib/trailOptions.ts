/**
 * A trail the draft's AllTrails search found (#6): its page, name and
 * description, and what its page gave the search of its picture and numbers.
 */
export type TrailOption = {
  url: string;
  title: string;
  description: string;
  image?: string;
  rating?: number;
  reviews?: number;
  miles?: number;
  feet?: number;
};

const count = new Intl.NumberFormat('en-US');

/**
 * A trail's numbers, those it has, each kept whole for a line:
 * ["★ 4.7 (1,234)", "8.4 mi", "1,640 ft gain"].
 */
export function trailNumbers(trail: TrailOption): string[] {
  const rated =
    trail.rating === undefined
      ? ''
      : `★ ${trail.rating.toFixed(1)}${trail.reviews === undefined ? '' : ` (${count.format(trail.reviews)})`}`;
  return [
    rated,
    trail.miles === undefined ? '' : `${Number(trail.miles.toFixed(1))} mi`,
    trail.feet === undefined ? '' : `${count.format(trail.feet)} ft gain`,
  ].filter(Boolean);
}
