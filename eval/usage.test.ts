import { describe, expect, it } from 'vitest';
import { median, renderUsage, usageOf } from './usage.js';

const drafted = (queries: unknown, tokens: unknown) => ({
  event: 'draft.generated',
  ms: 1000,
  queries,
  tokens,
});
const timed = (ms: number, geminiMs: number) => ({
  event: 'draft.timing',
  ms,
  geminiMs,
  lookupsMs: ms - geminiMs,
});

describe('usageOf', () => {
  it('adds up what each case’s drafts logged, and its judge calls', () => {
    const usage = usageOf([
      {
        events: [
          drafted(['a', 'b'], { prompt: 100, tools: 50, thinking: 900, output: 300 }),
          timed(22_000, 20_000),
          { event: 'draft.trail_search', queries: ['x', 'y', 'z'] },
          { event: 'cover.found' },
        ],
        judgeCalls: 1,
      },
      {
        events: [drafted([], { prompt: 10 }), timed(5000, 4500)],
        judgeCalls: 0,
      },
      { events: [], judgeCalls: 2 },
    ]);
    expect(usage).toEqual({
      drafts: 2,
      googleSearches: 2,
      allTrailsSearches: 3,
      judgeCalls: 3,
      tokens: { prompt: 160, thinking: 900, output: 300 },
      draftMs: [22_000, 5000],
      geminiMs: [20_000, 4500],
      lookupsMs: [2000, 500],
    });
  });

  it('counts what a malformed event doesn’t say as nothing', () => {
    const usage = usageOf([
      {
        events: [
          drafted('a', null),
          { event: 'draft.generated', tokens: { prompt: 'x', thinking: Number.NaN } },
          { event: 'draft.timing' },
          { event: 'draft.trail_search', queries: 'q' },
        ],
        judgeCalls: 0,
      },
    ]);
    expect(usage).toEqual({
      drafts: 2,
      googleSearches: 0,
      allTrailsSearches: 0,
      judgeCalls: 0,
      tokens: { prompt: 0, thinking: 0, output: 0 },
      draftMs: [0],
      geminiMs: [0],
      lookupsMs: [0],
    });
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25);
  });
});

describe('renderUsage', () => {
  const usage = usageOf([
    {
      events: [
        drafted(['a', 'b'], { prompt: 100, thinking: 900, output: 300 }),
        timed(22_000, 20_000),
        { event: 'draft.trail_search', queries: ['x', 'y', 'z', 'w', 'v'] },
      ],
      judgeCalls: 1,
    },
    { events: [drafted(['c'], {}), timed(48_000, 46_000)], judgeCalls: 0 },
  ]);

  it('says what the run spent, where a draft’s time went, and what its searches cost', () => {
    expect(renderUsage(usage)).toBe(
      [
        'USAGE',
        '  2 drafts · 3 Google searches by drafts · 5 AllTrails searches · 1 judge calls',
        "  drafts' tokens: 100 in, 900 thinking, 300 out",
        '  a draft took 35.0s (median; slowest 48.0s): Gemini 33.0s, then 2.0s for its cover, trail and park',
        "  drafts' searches: about $0.06 past Google's free ones (judge calls search too, and aren't counted)",
      ].join('\n'),
    );
  });

  it('leaves out the time when no draft ran', () => {
    expect(renderUsage(usageOf([{ events: [], judgeCalls: 4 }]))).toBe(
      [
        'USAGE',
        '  0 drafts · 0 Google searches by drafts · 0 AllTrails searches · 4 judge calls',
        "  drafts' tokens: 0 in, 0 thinking, 0 out",
        "  drafts' searches: about $0.00 past Google's free ones (judge calls search too, and aren't counted)",
      ].join('\n'),
    );
  });
});
