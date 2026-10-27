import { addMinutesToHHMM, parseHHMM, type Trip, type TripActivity } from './userTrips';

// A trip's days on a phone (#294): one day at a time, each place a row
// saying when in the day it falls, reordered a step at a time.

export type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening';

/** When in the day `start` ("HH:MM") falls; null when there's no time. */
export function timeOfDay(start: string | null): TimeOfDay | null {
  const parsed = start ? parseHHMM(start) : null;
  if (!parsed) return null;
  if (parsed.hours < 12) return 'Morning';
  if (parsed.hours < 17) return 'Afternoon';
  return 'Evening';
}

function dayDate(trip: Pick<Trip, 'start_date'>, dayIndex: number): Date | null {
  const date = new Date(`${trip.start_date}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date;
}

/** A day's button: "Sat 12", or "Day 2" when the trip's dates don't read. */
export function shortDayLabel(trip: Pick<Trip, 'start_date'>, dayIndex: number): string {
  const date = dayDate(trip, dayIndex);
  if (!date) return `Day ${dayIndex + 1}`;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday.format(date)} ${date.getUTCDate()}`;
}

/** A day by name, for "Add a place to Saturday": "Saturday", or "day 2". */
export function dayName(trip: Pick<Trip, 'start_date'>, dayIndex: number): string {
  const date = dayDate(trip, dayIndex);
  if (!date) return `day ${dayIndex + 1}`;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date);
}

/** "3 places", "1 place", or "Nothing yet". */
export function placesCount(n: number): string {
  if (n === 0) return 'Nothing yet';
  return `${n} place${n === 1 ? '' : 's'}`;
}

/** A day's places in the order a phone shows them: by start time, untimed last. */
export function dayOrder(day: readonly TripActivity[]): TripActivity[] {
  return [...day].sort((x, y) => (x.start_time ?? '99:99').localeCompare(y.start_time ?? '99:99'));
}

const DAY_END = 24 * 60 - 1;

function minutesOf(start: string | null): number | null {
  const parsed = start ? parseHHMM(start) : null;
  return parsed ? parsed.hours * 60 + parsed.minutes : null;
}

function hhmm(minutes: number): string {
  return addMinutesToHHMM('00:00', minutes);
}

/**
 * The start times that move the place at `index` of a day (in
 * {@link dayOrder}) one step earlier (-1) or later (+1), so it lands exactly
 * one place on. Two with their own different times swap them. Otherwise, or
 * where a third place shares a time, each place from the move on keeps its
 * time if it's still later than the one before, and is otherwise timed a
 * minute after it (an untimed one from the next time, or nine). A run that
 * would pass the day's last minute is timed back from it instead. The two
 * moved come first, earlier then later (a swap: the moved one first), then
 * any other place whose time changed. Nothing at the day's ends.
 */
export function moveWithinDay(
  day: readonly TripActivity[],
  index: number,
  by: -1 | 1,
): { id: string; start_time: string }[] {
  const moved = day[index];
  const neighbour = day[index + by];
  if (!moved || !neighbour) return [];
  const from = Math.min(index, index + by);
  const order = [...day];
  [order[from], order[from + 1]] = [order[from + 1], order[from]];
  const own = order.map((place) => minutesOf(place.start_time));
  const a = minutesOf(moved.start_time);
  const b = minutesOf(neighbour.start_time);
  const swap = a !== null && b !== null && a !== b;
  // A swap: the earlier time goes first, whichever way it moved.
  if (swap) [own[from], own[from + 1]] = [Math.min(a, b), Math.max(a, b)];
  // Untimed places can only trail the day, so the two moved are the last
  // that need a time, and any untimed before them need one too.
  const last = from + 1;
  const firstUntimed = own.indexOf(null);
  const start = firstUntimed === -1 ? from : Math.min(from, firstUntimed);
  const timed = [...own];
  let overflow = false;
  for (let k = start; k < order.length; k++) {
    // Past the two moved, a place after one that kept its time is where it
    // was, and so is the rest: places sharing a time there keep theirs.
    if (k > last + 1 && timed[k - 1] === own[k - 1]) break;
    const prev = k > 0 ? timed[k - 1] : null;
    let t = timed[k];
    if (t === null) {
      if (k > last) continue;
      t = prev !== null ? prev + 1 : (own.slice(k + 1).find((m) => m !== null) ?? 9 * 60);
    } else if (prev !== null && t <= prev) {
      t = prev + 1;
    }
    if (t > DAY_END) overflow = true;
    timed[k] = t;
  }
  if (overflow) {
    // Back from the day's last minute: each before the next.
    const lastTimed = timed.findLastIndex((m) => m !== null);
    for (let k = lastTimed; k >= 0; k--) {
      const next = k < lastTimed ? timed[k + 1] : null;
      // From the times just given, so the two moved stay a minute apart.
      const t = Math.min(timed[k] ?? DAY_END, DAY_END);
      if (next !== null && t >= next) timed[k] = next - 1;
      else if (k < start) break;
      else timed[k] = t;
    }
  }
  const pair = swap ? [moved, neighbour] : [order[from], order[from + 1]];
  // The two moved (in pair order), then the others whose time changed.
  const rank = (place: TripActivity, k: number) => {
    const i = pair.indexOf(place);
    return i === -1 ? 2 + k : i;
  };
  return order
    .flatMap((place, k) => {
      const m = timed[k];
      const keep = pair.includes(place) || m !== minutesOf(place.start_time);
      return m !== null && keep ? [{ place, m, rank: rank(place, k) }] : [];
    })
    .sort((x, y) => x.rank - y.rank)
    .map(({ place, m }) => ({ id: place.id, start_time: hhmm(m) }));
}
