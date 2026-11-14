import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseHHMM } from './userTrips';

// A start time arrives from the API or a time input, so parseHHMM must hold
// for any string. Examples are in userTrips.test.ts.

const pad = (n: number) => String(n).padStart(2, '0');

// Strings near HH:MM, so the generator often hits a time and often just misses.
const nearly = fc.string({
  unit: fc.constantFrom('0', '1', '2', '3', '5', '6', '9', ':', ' ', 'x', '٣'),
  minLength: 4,
  maxLength: 6,
});

const asciiDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

// A time of day, said a second way: HH:MM, ASCII digits, the hour under 24 and
// the minute under 60.
function isTimeOfDay(value: string): boolean {
  return (
    value.length === 5 &&
    value[2] === ':' &&
    [0, 1, 3, 4].every((i) => asciiDigit(value[i])) &&
    Number(value.slice(0, 2)) < 24 &&
    Number(value.slice(3)) < 60
  );
}

describe('parseHHMM, for any string', () => {
  it('never throws, and parses exactly the times of day written HH:MM', () => {
    fc.assert(
      fc.property(fc.oneof(nearly, fc.string({ unit: 'binary', maxLength: 12 })), (value) => {
        expect(parseHHMM(value) !== null).toBe(isTimeOfDay(value));
      }),
    );
  });

  it('reads back the hour and minute every time of day was written with', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (hours, minutes) => {
          expect(parseHHMM(`${pad(hours)}:${pad(minutes)}`)).toEqual({ hours, minutes });
        },
      ),
    );
  });
});
