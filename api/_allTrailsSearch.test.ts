import { describe, expect, it, vi } from 'vitest';
import {
  TRAIL_SEARCH_PROMPT,
  findAllTrailsUrl,
  trailPage,
  trailQuestion,
  type DraftedHike,
} from './_allTrailsSearch.js';

const DRAGON: DraftedHike = {
  name: 'Dragon Mountain Peak (Thiên Long Sơn)',
  city: 'Milpitas',
  lat: 37.4524,
  lng: -121.8505,
  shortDescription: 'Climb the 450-step Stairway to Heaven',
  longDescription: 'A Vietnamese Buddhist sanctuary above Calaveras Road.',
};
const STAIRS = 'https://www.alltrails.com/trail/us/california/dragon-mountain-stairs';

const answering = (answer: string | undefined) => vi.fn(() => Promise.resolve(answer));

describe('trailQuestion', () => {
  it('asks with the draft’s names, town, pin and descriptions, one to a line', () => {
    const q = trailQuestion(DRAGON);
    expect(q.system).toBe(TRAIL_SEARCH_PROMPT);
    expect(q.user).toBe(
      [
        'Place: Dragon Mountain Peak (Thiên Long Sơn)',
        'Town: Milpitas',
        'Coordinates: 37.4524, -121.8505',
        'Short description: Climb the 450-step Stairway to Heaven',
        'Description: A Vietnamese Buddhist sanctuary above Calaveras Road.',
      ].join('\n'),
    );
    expect(q.schema).toEqual({
      type: 'object',
      properties: {
        allTrailsUrl: {
          type: 'string',
          description: 'The alltrails.com/trail/ page of the route; omit if none was found',
        },
      },
    });
  });

  it('leaves out the facts the draft doesn’t have', () => {
    const q = trailQuestion({ name: 'Mission Peak', lat: 37.5, lng: -121.9, city: '  ', shortDescription: 7 });
    expect(q.user).toBe('Place: Mission Peak\nCoordinates: 37.5, -121.9');
  });

  it('trims what it passes on', () => {
    expect(trailQuestion({ ...DRAGON, city: ' Milpitas ', shortDescription: null, longDescription: undefined }).user).toBe(
      'Place: Dragon Mountain Peak (Thiên Long Sơn)\nTown: Milpitas\nCoordinates: 37.4524, -121.8505',
    );
  });

  it('tells Gemini to search AllTrails by every name, and never to make a link up', () => {
    expect(TRAIL_SEARCH_PROMPT).toMatch(/every name the place goes by/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/Never construct a URL/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/vertexaisearch\.cloud\.google\.com/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/Leave "allTrailsUrl" out/);
  });
});

describe('trailPage', () => {
  it('takes an alltrails.com trail page, as a clean https link', () => {
    const cases: [string, string][] = [
      [STAIRS, STAIRS],
      [
        'https://alltrails.com/trail/us/california/dragon-mountain-trail-2?u=i#reviews',
        'https://www.alltrails.com/trail/us/california/dragon-mountain-trail-2',
      ],
      ['http://www.alltrails.com/trail/us/california/dragon-mountain-stairs/', STAIRS],
      [`  ${STAIRS}\n`, STAIRS],
      [
        'https://www.alltrails.com/trail/canada/british-columbia/Grouse-Grind',
        'https://www.alltrails.com/trail/canada/british-columbia/Grouse-Grind',
      ],
    ];
    for (const [given, kept] of cases) expect(trailPage(given), given).toBe(kept);
  });

  it('turns down anything else', () => {
    for (const url of [
      'https://www.alltrails.com/parks/us/california/ed-r-levin-county-park',
      // An index, not a trail: a country, or a country and a region.
      'https://www.alltrails.com/trail/us',
      'https://www.alltrails.com/trail/us/california',
      'https://www.alltrails.com/trail/us/california/',
      'https://www.alltrails.com/trail/us/california/x/photos',
      'https://www.alltrails.com/trail/x/trail/us/california/x',
      'https://www.alltrails.com/trail//california/x',
      'https://www.alltrails.com/trail/',
      'https://www.alltrails.com/trail',
      'https://www.alltrails.com/trail/us/california/dragon%20mountain',
      'https://u:p@www.alltrails.com/trail/us/california/dragon-mountain-stairs',
      'https://u@www.alltrails.com/trail/us/california/dragon-mountain-stairs',
      'https://www.alltrails.com:444/trail/us/california/dragon-mountain-stairs',
      // Saved links are held to /trail/ at the start (isSavableUrl).
      'https://www.alltrails.com/es/trail/us/california/dragon-mountain-stairs',
      'https://www.alltrails.com/',
      'https://www.alltrails.com/explore?trail=x',
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
      'https://evil.example/trail/us/california/x',
      'https://alltrails.com.evil.example/trail/us/california/x',
      'javascript:alert(1)//www.alltrails.com/trail/us/california/x',
      'not a url',
      '',
      null,
      42,
    ]) {
      expect(trailPage(url), String(url)).toBeNull();
    }
  });
});

describe('findAllTrailsUrl', () => {
  it('asks once, and keeps the trail page Gemini found', async () => {
    const ask = answering(JSON.stringify({ allTrailsUrl: STAIRS }));
    expect(await findAllTrailsUrl(DRAGON, ask)).toBe(STAIRS);
    expect(ask).toHaveBeenCalledTimes(1);
    // Kept as the clean link, not as given.
    expect(await findAllTrailsUrl(DRAGON, answering(JSON.stringify({ allTrailsUrl: `${STAIRS}?ref=x` })))).toBe(STAIRS);
    expect(ask).toHaveBeenCalledWith(trailQuestion(DRAGON));
  });

  it('finds nothing when Gemini found nothing, or gave anything but a trail page', async () => {
    for (const answer of [
      undefined,
      '',
      '{}',
      'null',
      '[]',
      JSON.stringify({ allTrailsUrl: null }),
      JSON.stringify({ allTrailsUrl: 'https://www.alltrails.com/parks/us/california/x' }),
      JSON.stringify({ allTrailsUrl: 'https://www.alltrails.com/trail/us/california' }),
      JSON.stringify({ allTrailsUrl: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' }),
      'not json',
    ]) {
      expect(await findAllTrailsUrl(DRAGON, answering(answer)), String(answer)).toBeNull();
    }
  });

  it('never throws: a request that fails leaves the link out', async () => {
    const ask = vi.fn(() => Promise.reject(new Error('timed out')));
    expect(await findAllTrailsUrl(DRAGON, ask)).toBeNull();
  });
});
