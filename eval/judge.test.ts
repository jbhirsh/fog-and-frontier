// Unit tests for the pure helpers in eval/judge.ts, per the repo convention
// that new pure utils ship with tests. matchesSchema gates every judge verdict
// against schema drift; extractText unwraps the Gemini response envelope;
// describeEvent renders the event lines the events judge grades from (its
// ISO-date-first format is what prevents the judge mis-inferring the year).

import { describe, expect, it } from 'vitest';
import { describeEvent, extractText, matchesSchema } from './judge.js';
import type { JsonSchema } from './judge.js';

describe('matchesSchema', () => {
  it('validates primitives', () => {
    expect(matchesSchema('hi', { type: 'string' })).toBe(true);
    expect(matchesSchema(3, { type: 'string' })).toBe(false);
    expect(matchesSchema(true, { type: 'boolean' })).toBe(true);
    expect(matchesSchema('true', { type: 'boolean' })).toBe(false);
    expect(matchesSchema(1.5, { type: 'number' })).toBe(true);
    expect(matchesSchema(Number.NaN, { type: 'number' })).toBe(false);
    expect(matchesSchema(Number.POSITIVE_INFINITY, { type: 'number' })).toBe(false);
    expect(matchesSchema(3, { type: 'integer' })).toBe(true);
    expect(matchesSchema(3.5, { type: 'integer' })).toBe(false);
  });

  it('validates arrays element-wise', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'integer' } };
    expect(matchesSchema([1, 2, 3], schema)).toBe(true);
    expect(matchesSchema([], schema)).toBe(true);
    expect(matchesSchema([1, 'two'], schema)).toBe(false);
    expect(matchesSchema('not-an-array', schema)).toBe(false);
  });

  it('enforces required keys and property types on objects', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        plausible: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['plausible'],
    };
    expect(matchesSchema({ plausible: true, reason: 'ok' }, schema)).toBe(true);
    expect(matchesSchema({ reason: 'missing required' }, schema)).toBe(false);
    expect(matchesSchema({ plausible: 'yes' }, schema)).toBe(false);
    // Optional property absent or undefined is fine; extra keys are tolerated.
    expect(matchesSchema({ plausible: false }, schema)).toBe(true);
    expect(matchesSchema({ plausible: false, reason: undefined }, schema)).toBe(true);
    expect(matchesSchema({ plausible: false, extra: 42 }, schema)).toBe(true);
    expect(matchesSchema(null, schema)).toBe(false);
    expect(matchesSchema([], schema)).toBe(false);
  });

  it('recurses through nested object/array schemas', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        verdicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { index: { type: 'integer' }, ok: { type: 'boolean' } },
            required: ['index', 'ok'],
          },
        },
      },
      required: ['verdicts'],
    };
    expect(matchesSchema({ verdicts: [{ index: 0, ok: true }] }, schema)).toBe(true);
    expect(matchesSchema({ verdicts: [{ index: 0 }] }, schema)).toBe(false);
    expect(matchesSchema({ verdicts: [{ index: 0.5, ok: true }] }, schema)).toBe(false);
  });
});

describe('extractText', () => {
  const envelope = (text: unknown) => ({
    candidates: [{ content: { parts: [{ text }] } }],
  });

  it('unwraps the first candidate part text', () => {
    expect(extractText(envelope('{"plausible":true}'))).toBe('{"plausible":true}');
  });

  it('returns null for every malformed envelope shape', () => {
    expect(extractText(null)).toBeNull();
    expect(extractText('string')).toBeNull();
    expect(extractText({})).toBeNull();
    expect(extractText({ candidates: [] })).toBeNull();
    expect(extractText({ candidates: ['nope'] })).toBeNull();
    expect(extractText({ candidates: [{ content: null }] })).toBeNull();
    expect(extractText({ candidates: [{ content: { parts: [] } }] })).toBeNull();
    expect(extractText(envelope(42))).toBeNull();
  });
});

describe('describeEvent', () => {
  it('leads with the ISO date (range) and keeps dateText as a supplement', () => {
    const line = describeEvent(
      {
        name: 'FIFA World Cup 2026',
        startDate: '2026-07-10',
        endDate: '2026-07-11',
        dateText: 'Fri–Sat',
        location: 'Santa Clara',
        blurb: 'Group stage',
        sourceUrl: 'https://example.com/wc',
      },
      2,
    );
    expect(line).toContain('[2] FIFA World Cup 2026');
    expect(line).toContain('date: 2026-07-10..2026-07-11 (Fri–Sat)');
    expect(line).toContain('location: Santa Clara');
    expect(line).toContain('source: https://example.com/wc');
  });

  it('marks a missing startDate instead of silently omitting the year context', () => {
    const line = describeEvent({ name: 'Farmers Market', dateText: 'Sat Jul 11' }, 0);
    expect(line).toContain('date: (no startDate) (Sat Jul 11)');
  });

  it('renders placeholders for a non-record event', () => {
    const line = describeEvent(null, 1);
    expect(line).toContain('[1] (no name)');
    expect(line).toContain('date: (no startDate)');
    expect(line).toContain('location: (no location)');
  });
});
