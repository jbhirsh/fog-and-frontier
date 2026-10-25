import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_SEARCH_URL,
  HttpError,
  MAX_ROUNDS,
  MAX_SEARCHES,
  TRAIL_SEARCH_PROMPT,
  findAllTrailsUrl,
  trailPage,
  trailQuestion,
  trailRequest,
  trailResults,
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
const OTHER = 'https://www.alltrails.com/trail/us/california/dragon-mountain-trail-2';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trailQuestion', () => {
  it('tells Gemini the draft’s names, town, pin and descriptions, one to a line', () => {
    expect(trailQuestion(DRAGON)).toBe(
      [
        'Place: Dragon Mountain Peak (Thiên Long Sơn)',
        'Town: Milpitas',
        'Coordinates: 37.4524, -121.8505',
        'Short description: Climb the 450-step Stairway to Heaven',
        'Description: A Vietnamese Buddhist sanctuary above Calaveras Road.',
      ].join('\n'),
    );
  });

  it('leaves out the facts the draft doesn’t have', () => {
    expect(
      trailQuestion({
        name: 'Mission Peak',
        lat: 37.5,
        lng: -121.9,
        city: '  ',
        shortDescription: 7,
      }),
    ).toBe('Place: Mission Peak\nCoordinates: 37.5, -121.9');
  });

  it('trims what it passes on', () => {
    expect(
      trailQuestion({
        ...DRAGON,
        city: ' Milpitas ',
        shortDescription: null,
        longDescription: undefined,
      }),
    ).toBe(
      'Place: Dragon Mountain Peak (Thiên Long Sơn)\nTown: Milpitas\nCoordinates: 37.4524, -121.8505',
    );
  });

  it('passes on the draft’s own trail page as a lead to check, and nothing else', () => {
    const asked = (allTrailsUrl: unknown) =>
      trailQuestion({ name: 'X', lat: 1, lng: 2, allTrailsUrl }).split('\n').slice(2);
    expect(asked(`${STAIRS}?ref=x`)).toEqual([
      `A web search suggested ${STAIRS}; search for it to check.`,
    ]);
    for (const link of [null, '', 'https://www.alltrails.com/parks/us/california/x', 42]) {
      expect(asked(link), String(link)).toEqual([]);
    }
  });

  it('tells Gemini to search AllTrails by every name, and to choose only a trail at the place', () => {
    expect(TRAIL_SEARCH_PROMPT).toMatch(/Search with search_alltrails/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/every name the place goes by/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/answer with choose_trail/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/A trail elsewhere, even with a similar name/);
    expect(TRAIL_SEARCH_PROMPT).toMatch(/call choose_trail without a url/);
  });
});

describe('trailRequest', () => {
  const contents = [{ role: 'user', parts: [{ text: 'Place: X' }] }];
  const TOOLS = [
    {
      functionDeclarations: [
        {
          name: 'search_alltrails',
          description:
            "Searches AllTrails' trail pages. Returns up to 10 trails, each with its url, title and a snippet of its page.",
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'What to search for' } },
            required: ['query'],
          },
        },
        {
          name: 'choose_trail',
          description: 'Gives your answer: the trail at this place, from your search results.',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description:
                  "The trail's url, exactly as a search returned it; omit if none matches",
              },
            },
          },
        },
      ],
    },
  ];

  it('offers the search and the choice, at low effort, letting Gemini pick which', () => {
    expect(trailRequest(contents, false)).toEqual({
      systemInstruction: { parts: [{ text: TRAIL_SEARCH_PROMPT }] },
      contents,
      tools: TOOLS,
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    });
  });

  it('makes Gemini choose on the last turn', () => {
    expect(trailRequest(contents, true).toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['choose_trail'] },
    });
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
      // The same trail's page in another language, kept as the page a saved
      // link may be (isSavableUrl holds those to /trail/ at the start).
      ['https://www.alltrails.com/es/trail/us/california/dragon-mountain-stairs', STAIRS],
      ['https://www.alltrails.com/de/trail/us/california/dragon-mountain-stairs', STAIRS],
      ['https://www.alltrails.com/pt-br/trail/us/california/dragon-mountain-stairs', STAIRS],
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
      'https://www.alltrails.com/deutsch/trail/us/california/x',
      'ftp://www.alltrails.com/trail/us/california/dragon-mountain-stairs',
      'https://www.alltrails.com/trail//california/x',
      'https://www.alltrails.com/trail/',
      'https://www.alltrails.com/trail',
      'https://www.alltrails.com/trail/us/california/dragon%20mountain',
      'https://u:p@www.alltrails.com/trail/us/california/dragon-mountain-stairs',
      'https://u@www.alltrails.com/trail/us/california/dragon-mountain-stairs',
      'https://:p@www.alltrails.com/trail/us/california/dragon-mountain-stairs',
      'https://www.alltrails.com:444/trail/us/california/dragon-mountain-stairs',
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

// An Agent Search result for a web page.
const result = (
  link: unknown,
  title: unknown = 'Dragon Mountain Stairs',
  snippet: unknown = 'Milpitas',
) => ({
  document: { derivedStructData: { link, title, snippets: [{ snippet }] } },
});

describe('trailResults', () => {
  it('lists each trail page once, as a clean link with its title and first snippet', () => {
    expect(
      trailResults({
        results: [
          result(`${STAIRS}?ref=x`, ' Dragon Mountain Stairs ', ' Near Milpitas '),
          result('https://www.alltrails.com/parks/us/california/ed-r-levin-county-park'),
          result(STAIRS, 'again'),
          { document: { derivedStructData: { link: OTHER, title: 7, snippets: [] } } },
          {
            document: {
              derivedStructData: {
                link: 'https://www.alltrails.com/de/trail/us/ca/x',
                snippets: 'x',
              },
            },
          },
          {
            document: {
              derivedStructData: {
                link: 'https://www.alltrails.com/trail/us/ca/y',
                snippets: [null],
              },
            },
          },
          { document: {} },
          {},
          null,
        ],
      }),
    ).toEqual([
      { url: STAIRS, title: 'Dragon Mountain Stairs', snippet: 'Near Milpitas' },
      { url: OTHER, title: '', snippet: '' },
      { url: 'https://www.alltrails.com/trail/us/ca/x', title: '', snippet: '' },
      { url: 'https://www.alltrails.com/trail/us/ca/y', title: '', snippet: '' },
    ]);
  });

  it('finds nothing in a response without results', () => {
    for (const response of [undefined, null, {}, { results: {} }, { results: [] }, 'x']) {
      expect(trailResults(response), JSON.stringify(response)).toEqual([]);
    }
  });
});

describe('HttpError', () => {
  it('names the status it failed with', () => {
    const err = new HttpError(503);
    expect(err).toBeInstanceOf(Error);
    expect([err.name, err.message, err.status, err.detail]).toEqual([
      'HttpError',
      'HTTP 503',
      503,
      '',
    ]);
    expect(new HttpError(400, 'bad query').detail).toBe('bad query');
  });
});

it('searches the Agent Search app that indexes AllTrails’ trail pages', () => {
  expect(AGENT_SEARCH_URL).toBe(
    'https://discoveryengine.googleapis.com/v1/projects/gen-lang-client-0818068083/locations/global/collections/default_collection/engines/alltrails-search_1792884407396/servingConfigs/default_search:searchLite',
  );
});

describe('findAllTrailsUrl', () => {
  type Call = { name: unknown; args?: unknown; id?: string };
  // Gemini's reply making these calls, with the thought signature it must get back.
  const replying = (...calls: Call[]) => ({
    candidates: [
      {
        content: {
          role: 'model',
          parts: calls.map((functionCall) => ({ functionCall, thoughtSignature: 'sig' })),
        },
      },
    ],
  });
  const search = (query: unknown, id?: string): Call => ({
    name: 'search_alltrails',
    args: { query },
    ...(id ? { id } : {}),
  });
  const choose = (url?: unknown): Call => ({
    name: 'choose_trail',
    args: url === undefined ? {} : { url },
  });
  /** Gemini answers in turn; each query finds the pages given for it. */
  function tools(replies: unknown[], pages: Record<string, unknown[]> = {}) {
    return {
      gemini: vi.fn<(body: unknown) => Promise<unknown>>(() => Promise.resolve(replies.shift())),
      search: vi.fn((query: string) => Promise.resolve({ results: pages[query] ?? [] })),
    };
  }
  const STAIRS_FOUND = { 'dragon mountain stairs': [result(STAIRS)] };
  /** The events the search logged. */
  function logged() {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const unstamped = new Set(['ts', 'level', 'source']);
    return () =>
      info.mock.calls.map((c) =>
        Object.fromEntries(
          Object.entries(JSON.parse(String(c[0])) as Record<string, unknown>).filter(
            ([key]) => !unstamped.has(key),
          ),
        ),
      );
  }

  it('searches as Gemini asks, and keeps the trail it chose from what came back', async () => {
    const events = logged();
    // Started at 1,000 ms, done at 1,250.
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(1250);
    const t = tools(
      [replying(search(' dragon mountain stairs ')), replying(choose(STAIRS))],
      STAIRS_FOUND,
    );
    expect(await findAllTrailsUrl(DRAGON, t)).toBe(STAIRS);
    expect(t.search.mock.calls).toEqual([['dragon mountain stairs']]);
    const asked = [{ role: 'user', parts: [{ text: trailQuestion(DRAGON) }] }];
    expect(t.gemini.mock.calls[0]?.[0]).toEqual(trailRequest(asked, false));
    // Its reply goes back whole, signature and all, with what the search found
    // (and no id, since its call had none).
    expect(t.gemini.mock.calls[1]?.[0]).toStrictEqual(
      trailRequest(
        [
          ...asked,
          replying(search(' dragon mountain stairs ')).candidates[0]?.content,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'search_alltrails',
                  response: {
                    results: [
                      { url: STAIRS, title: 'Dragon Mountain Stairs', snippet: 'Milpitas' },
                    ],
                  },
                },
              },
            ],
          },
        ],
        false,
      ),
    );
    expect(events()).toEqual([
      {
        event: 'draft.trail_search',
        ms: 250,
        queries: ['dragon mountain stairs'],
        results: 1,
        pick: STAIRS,
        chosen: true,
        kept: true,
      },
    ]);
  });

  it('runs the searches of one reply together, answering each by its id', async () => {
    logged();
    const t = tools([replying(search('a', 'c1'), search('b', 'c2')), replying(choose(OTHER))], {
      a: [result(STAIRS)],
      b: [result(OTHER)],
    });
    expect(await findAllTrailsUrl(DRAGON, t)).toBe(OTHER);
    const sent = t.gemini.mock.calls[1]?.[0] as { contents: { parts: unknown[] }[] };
    expect(sent.contents[2]?.parts).toEqual([
      {
        functionResponse: {
          name: 'search_alltrails',
          id: 'c1',
          response: {
            results: [{ url: STAIRS, title: 'Dragon Mountain Stairs', snippet: 'Milpitas' }],
          },
        },
      },
      {
        functionResponse: {
          name: 'search_alltrails',
          id: 'c2',
          response: {
            results: [{ url: OTHER, title: 'Dragon Mountain Stairs', snippet: 'Milpitas' }],
          },
        },
      },
    ]);
  });

  it('keeps the clean link of a trail a search returned, however it was chosen', async () => {
    logged();
    for (const chosen of [
      `${STAIRS}?ref=x`,
      'https://alltrails.com/de/trail/us/california/dragon-mountain-stairs/',
    ]) {
      const t = tools(
        [replying(search('dragon mountain stairs')), replying(choose(chosen))],
        STAIRS_FOUND,
      );
      expect(await findAllTrailsUrl(DRAGON, t), chosen).toBe(STAIRS);
    }
  });

  it('turns down a trail no search returned, as one it may have made up', async () => {
    const events = logged();
    const t = tools(
      [replying(search('dragon mountain stairs')), replying(choose(OTHER))],
      STAIRS_FOUND,
    );
    expect(await findAllTrailsUrl(DRAGON, t)).toBeNull();
    // Nor one it chose without searching at all.
    expect(await findAllTrailsUrl(DRAGON, tools([replying(choose(STAIRS))]))).toBeNull();
    expect(events().map((e) => [e.chosen, e.kept, e.results])).toEqual([
      [true, false, 1],
      [true, false, 0],
    ]);
  });

  it('finds nothing when Gemini chose nothing, or anything but a trail page', async () => {
    const events = logged();
    for (const url of [
      undefined,
      null,
      '',
      'https://www.alltrails.com/parks/us/california/x',
      42,
    ]) {
      const t = tools(
        [replying(search('dragon mountain stairs')), replying(choose(url))],
        STAIRS_FOUND,
      );
      expect(await findAllTrailsUrl(DRAGON, t), String(url)).toBeNull();
    }
    expect(events().every((e) => e.chosen === false && e.kept === false)).toBe(true);
  });

  it('finds nothing when Gemini answers without choosing', async () => {
    const events = logged();
    // A call that isn't one is no call.
    const parts = [
      { text: STAIRS },
      { functionCall: 'choose_trail' },
      { functionCall: null },
      null,
    ];
    const text = { candidates: [{ content: { role: 'model', parts } }] };
    const t = tools([replying(search('dragon mountain stairs')), text], STAIRS_FOUND);
    expect(await findAllTrailsUrl(DRAGON, t)).toBeNull();
    expect(events()).toEqual([
      expect.objectContaining({
        event: 'draft.trail_search',
        results: 1,
        chosen: false,
        kept: false,
      }),
    ]);
  });

  it(`makes Gemini choose after ${MAX_ROUNDS} rounds of searching`, async () => {
    logged();
    const rounds = Array.from({ length: MAX_ROUNDS }, (_, i) => replying(search(`q${i}`)));
    const chooses = tools([...rounds, replying(choose(STAIRS))], { q1: [result(STAIRS)] });
    expect(await findAllTrailsUrl(DRAGON, chooses)).toBe(STAIRS);
    const modes = chooses.gemini.mock.calls.map(
      (c) =>
        (c[0] as { toolConfig: { functionCallingConfig: { mode: string } } }).toolConfig
          .functionCallingConfig.mode,
    );
    expect(modes).toEqual([...rounds.map(() => 'AUTO'), 'ANY']);
    // A last reply that searches anyway ends it, unsearched.
    const keeps = tools([...rounds, replying(search('more'))], { q1: [result(STAIRS)] });
    expect(await findAllTrailsUrl(DRAGON, keeps)).toBeNull();
    expect(keeps.search.mock.calls.flat()).toEqual(['q0', 'q1', 'q2']);
  });

  it(`runs at most ${MAX_SEARCHES} searches, and only the searches it offered`, async () => {
    logged();
    const many = Array.from({ length: MAX_SEARCHES + 2 }, (_, i) => search(`q${i}`));
    const odd: Call[] = [
      { name: 'browse', args: { query: 'x' } },
      search(''),
      search(7),
      { name: 'search_alltrails' },
    ];
    const t = tools([replying(...many, ...odd), replying(choose(STAIRS))], {
      q0: [result(STAIRS)],
    });
    expect(await findAllTrailsUrl(DRAGON, t)).toBe(STAIRS);
    expect(t.search).toHaveBeenCalledTimes(MAX_SEARCHES);
    const sent = t.gemini.mock.calls[1]?.[0] as {
      contents: { parts: { functionResponse: { name: unknown; response: unknown } }[] }[];
    };
    const told = sent.contents[2]?.parts.map((p) => p.functionResponse.response);
    expect(told?.slice(MAX_SEARCHES)).toEqual([
      { error: 'No searches left: choose a trail.' },
      { error: 'No searches left: choose a trail.' },
      { error: 'Not a search.' },
      { error: 'Not a search.' },
      { error: 'Not a search.' },
      { error: 'Not a search.' },
    ]);
    expect(sent.contents[2]?.parts[MAX_SEARCHES + 2]?.functionResponse.name).toBe('browse');
  });

  it('never throws: a request that fails can’t say, and the log says which and why', async () => {
    const events = logged();
    const failing = (gemini: () => Promise<unknown>, search?: () => Promise<unknown>) =>
      findAllTrailsUrl(DRAGON, {
        gemini: vi.fn(gemini),
        search: vi.fn(search ?? (() => Promise.resolve({ results: [] }))),
      });
    expect(await failing(() => Promise.reject(new HttpError(503)))).toBeUndefined();
    const searching = () => Promise.resolve(replying(search('x')));
    expect(
      await failing(searching, () => Promise.reject(new HttpError(400, 'Datastore not ready'))),
    ).toBeUndefined();
    expect(
      await failing(searching, () => Promise.reject(new TypeError('fetch failed'))),
    ).toBeUndefined();
    // Something thrown that isn't an Error.
    const thrown = { then: (_: unknown, reject: (reason: unknown) => void) => reject('reset') };
    expect(await failing(() => thrown as unknown as Promise<unknown>)).toBeUndefined();
    for (const reply of [
      undefined,
      {},
      { candidates: [] },
      { candidates: [{ content: 'x' }] },
      { candidates: [{ content: { parts: {} } }] },
    ]) {
      expect(await failing(() => Promise.resolve(reply)), JSON.stringify(reply)).toBeUndefined();
    }
    const ms = expect.any(Number) as number;
    expect(events()).toEqual([
      { event: 'draft.trail_search_failed', step: 'gemini', status: 503, detail: '', ms },
      {
        event: 'draft.trail_search_failed',
        step: 'search',
        status: 400,
        detail: 'Datastore not ready',
        ms,
      },
      { event: 'draft.trail_search_failed', step: 'search', error: 'TypeError', ms },
      { event: 'draft.trail_search_failed', step: 'gemini', error: 'Error', ms },
      ...Array.from({ length: 5 }, () => ({
        event: 'draft.trail_search_failed',
        step: 'gemini',
        error: 'NoReply',
        ms,
      })),
    ]);
  });

  it('says which step failed after a search that worked', async () => {
    const events = logged();
    const replies = [replying(search('x'))];
    const t = {
      gemini: vi.fn(() =>
        replies.length ? Promise.resolve(replies.shift()) : Promise.reject(new HttpError(500)),
      ),
      search: vi.fn(() => Promise.resolve({ results: [] })),
    };
    expect(await findAllTrailsUrl(DRAGON, t)).toBeUndefined();
    expect(events()).toEqual([
      expect.objectContaining({ event: 'draft.trail_search_failed', step: 'gemini', status: 500 }),
    ]);
  });
});
