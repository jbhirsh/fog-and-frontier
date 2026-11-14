import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isHHMM, isIsoDate } from './_trips.js';

// A trip's dates and its places' start times come straight from the API's
// callers, so the checks must hold for anything sent. Examples are in
// _trips.test.ts.

const pad = (n: number, width: number) => String(n).padStart(width, '0');

// Strings near the shapes, from the characters they're made of plus a few
// that aren't, so the generator often hits a valid one and often just misses.
const nearly = (length: number) =>
  fc.string({
    unit: fc.constantFrom('0', '1', '2', '3', '5', '6', '9', ':', '-', ' ', 'x', '٣'),
    minLength: length - 1,
    maxLength: length + 1,
  });

const anyInput = fc.oneof(
  fc.anything(),
  fc.string({ unit: 'binary', maxLength: 12 }),
  nearly(5),
  nearly(10),
);

const asciiDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

// What a date's format is, said a second way: ten characters, ASCII digits
// with dashes at 4 and 7. Whether the day exists isn't the check's job.
function hasDateFormat(value: string): boolean {
  return (
    value.length === 10 &&
    [...value].every((c, i) => (i === 4 || i === 7 ? c === '-' : asciiDigit(c)))
  );
}

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

describe('isIsoDate, for any input', () => {
  it('never throws, and accepts exactly the strings in a date’s format', () => {
    fc.assert(
      fc.property(anyInput, (value) => {
        expect(isIsoDate(value)).toBe(typeof value === 'string' && hasDateFormat(value));
      }),
    );
  });

  it('accepts every date written YYYY-MM-DD', () => {
    fc.assert(
      fc.property(fc.date({ noInvalidDate: true }), (date) => {
        const year = date.getUTCFullYear();
        fc.pre(year >= 0 && year <= 9999);
        expect(isIsoDate(date.toISOString().slice(0, 10))).toBe(true);
      }),
    );
  });
});

describe('isHHMM, for any input', () => {
  it('never throws, and accepts exactly the times of day written HH:MM', () => {
    fc.assert(
      fc.property(anyInput, (value) => {
        expect(isHHMM(value)).toBe(typeof value === 'string' && isTimeOfDay(value));
      }),
    );
  });

  it('accepts every minute of the day', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (h, m) => {
        expect(isHHMM(`${pad(h, 2)}:${pad(m, 2)}`)).toBe(true);
      }),
    );
  });
});
