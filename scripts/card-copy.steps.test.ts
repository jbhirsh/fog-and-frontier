// The steps behind `npm run cards`, with production's catalog and Gemini
// answered by a fake fetch, Turso by a fake client and the owner's answer
// by a fake prompt. The pure helpers are tested in card-copy.test.ts.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { main, type DogEntry, type Entry } from './card-copy.ts';

const fakes = vi.hoisted(() => ({
  answer: vi.fn<() => Promise<string>>(),
  batch: vi.fn<(stmts: unknown[], mode: string) => Promise<{ rowsAffected: number }[]>>(),
  connect: vi.fn(),
}));
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: () => fakes.answer(), close: () => {} }),
}));
vi.mock('@libsql/client', () => ({
  createClient: (config: unknown) => {
    fakes.connect(config);
    return { batch: fakes.batch };
  },
}));

type Asked = { id: string; name: string; lastTry?: string; partOf?: string }[];

/**
 * Production's catalog and Gemini: `places` answer the catalog read, and
 * `gemini` answers each Gemini call from the places it asked about.
 */
function network(
  activities: Record<string, unknown>[],
  gemini: (asked: Asked, body: Record<string, unknown>) => Record<string, unknown>[],
) {
  const calls: { asked: Asked; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn((url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (new URL(url).hostname === 'generativelanguage.googleapis.com') {
      const contents = body.contents as { parts: { text: string }[] }[];
      const asked = JSON.parse(contents[0].parts[0].text) as Asked;
      calls.push({ asked, body });
      const text = JSON.stringify({ places: gemini(asked, body) });
      return Promise.resolve(Response.json({ candidates: [{ content: { parts: [{ text }] } }] }));
    }
    return Promise.resolve(Response.json({ data: { activities } }));
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, calls };
}

let cwd: string;
let log: MockInstance<typeof console.log>;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cards-'));
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('GEMINI_API_KEY', 'key');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Back to src/test/setup.ts's offline fetch, for the tests after these.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.exitCode = undefined;
  fakes.answer.mockReset();
  fakes.batch.mockReset();
  fakes.connect.mockReset();
});

const LONG_NAME = 'Castle Rock State Park (Saratoga Gap & Ridge Loop)';
const place = (id: string, name: string, cardLine: string | null = null) => ({
  id,
  name,
  shortDescription: `About ${name}.`,
  category: 'hike',
  location: { city: 'Saratoga' },
  cardLine,
  cardName: null,
});
const logged = () => log.mock.calls.map((c) => String(c[0])).join('\n');

describe('cards draft', () => {
  it("drafts places without a line, asks again for one that didn't fit, and writes the file", async () => {
    const net = network(
      [place('cove', 'Cove'), place('rock', LONG_NAME), place('done', 'Done', 'Already set.')],
      (asked) =>
        asked.map((p) =>
          p.id === 'cove' && !p.lastTry
            ? { id: p.id, cardLine: 'x'.repeat(60) }
            : { id: p.id, cardLine: `Line for ${p.name.slice(0, 20)}`, cardName: 'Castle Rock' },
        ),
    );
    const file = join(cwd, 'review.json');
    await main(['draft', file]);
    // Two calls: the draft, then the one that came back too long, with its last try.
    expect(net.calls.map((c) => c.asked.map((p) => p.id))).toEqual([['cove', 'rock'], ['cove']]);
    expect(net.calls[1].asked[0].lastTry).toBe('x'.repeat(60));
    expect(net.calls[0].body.tools).toBeUndefined();
    // The catalog is read once, for exactly the fields a card needs.
    expect(net.fetch.mock.calls[0][1]).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          '{ activities { id name shortDescription category location { city } cardLine cardName } }',
      }),
    });
    // Gemini gets the system prompt, the places, and the schema it must answer in.
    expect(net.fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const body = net.calls[0].body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: unknown[] }[];
      generationConfig: unknown;
    };
    expect(body.systemInstruction.parts).toHaveLength(1);
    expect(body.systemInstruction.parts[0].text).toContain('place cards on a phone');
    expect(body.contents[0].role).toBe('user');
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          places: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                cardLine: { type: 'string' },
                cardName: { type: 'string' },
              },
              required: ['id', 'cardLine'],
            },
          },
        },
        required: ['places'],
      },
      thinkingConfig: { thinkingLevel: 'low' },
    });
    const written = JSON.parse(readFileSync(file, 'utf8')) as Entry[];
    expect(written.map((e) => [e.name, e.cardLine, e.cardName])).toEqual([
      [LONG_NAME, 'Line for Castle Rock State Pa', 'Castle Rock'],
      ['Cove', 'Line for Cove', null],
    ]);
    expect(logged()).toContain(`cards: wrote 2 places to ${file}`);
    expect(logged()).toContain('cards: drafting 2 places in 1 calls');
    expect(logged()).toContain("cards: asking again for 1 that didn't fit");
    expect(logged()).toContain(`cards: read and edit ${file}, then: npm run cards -- save ${file}`);
  });

  it('drafts every place with --all, and lists what still needs copy by hand', async () => {
    network([place('done', 'Done', 'Already set.')], () => []);
    const file = join(cwd, 'review.json');
    await main(['draft', file, '--all']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    expect(logged()).toContain('cards: 1 still need copy by hand:\n  Done: no card line');
  });

  it("reads the Gemini key from .env.local, and won't start without one", async () => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    network([], () => []);
    await expect(main(['draft', join(cwd, 'r.json')])).rejects.toThrow(
      'cards: GEMINI_API_KEY not set',
    );
    writeFileSync(join(cwd, '.env.local'), 'GEMINI_API_KEY=from-file\n');
    const net = network([place('cove', 'Cove')], (asked) =>
      asked.map((p) => ({ id: p.id, cardLine: 'A cove.' })),
    );
    await main(['draft', join(cwd, 'r.json')]);
    expect(String(net.fetch.mock.calls[1][0])).toContain('?key=from-file');
  });

  it("says when the catalog can't be read, or Gemini refuses", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ errors: [{ message: 'down' }] }))),
    );
    await expect(main(['draft', join(cwd, 'r.json')])).rejects.toThrow(
      "cards: the catalog couldn't be read (down); is it deployed?",
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 502 }))),
    );
    await expect(main(['draft', join(cwd, 'r.json')])).rejects.toThrow('(502)');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ errors: [] }, { status: 500 }))),
    );
    await expect(main(['draft', join(cwd, 'r.json')])).rejects.toThrow('(500)');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('generativelanguage')
            ? new Response(`quota ${'q'.repeat(400)}`, { status: 429 })
            : Response.json({ data: { activities: [place('cove', 'Cove')] } }),
        ),
      ),
    );
    // Gemini's reply is cut to its first 300 characters.
    await expect(main(['draft', join(cwd, 'r.json')])).rejects.toThrow(
      new RegExp(`^cards: Gemini answered 429: quota q{294}$`),
    );
  });
});

describe('cards dogs draft', () => {
  it("asks, with search, for each dog-friendly place's page, its park named", async () => {
    const net = network(
      [
        {
          id: 'park',
          name: 'Big Park',
          dogFriendly: false,
          dogRulesUrl: null,
          parentId: null,
          location: { city: 'A' },
        },
        {
          id: 'trail',
          name: 'Trail',
          dogFriendly: true,
          dogRulesUrl: null,
          parentId: 'park',
          location: { city: 'A' },
        },
        {
          id: 'beach',
          name: 'Beach',
          dogFriendly: true,
          dogRulesUrl: null,
          parentId: null,
          location: { city: 'B' },
        },
        {
          id: 'set',
          name: 'Set',
          dogFriendly: true,
          dogRulesUrl: 'https://x.gov/dogs',
          parentId: null,
          location: { city: 'C' },
        },
      ],
      () => [
        { id: 'trail', dogRulesUrl: 'https://parks.gov/dogs' },
        { id: 'beach', dogRulesUrl: 'https://www.yelp.com/biz/beach' },
      ],
    );
    const file = join(cwd, 'dogs.json');
    await main(['dogs', 'draft', file]);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].body.tools).toEqual([{ googleSearch: {} }]);
    expect(
      (net.calls[0].body.generationConfig as { responseJsonSchema: unknown }).responseJsonSchema,
    ).toEqual({
      type: 'object',
      properties: {
        places: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, dogRulesUrl: { type: 'string' } },
            required: ['id'],
          },
        },
      },
      required: ['places'],
    });
    expect(net.calls[0].asked).toEqual([
      { id: 'trail', name: 'Trail', city: 'A', partOf: 'Big Park' },
      { id: 'beach', name: 'Beach', city: 'B' },
    ]);
    const written = JSON.parse(readFileSync(file, 'utf8')) as DogEntry[];
    expect(written.map((e) => [e.name, e.dogRulesUrl])).toEqual([
      ['Beach', null],
      ['Trail', 'https://parks.gov/dogs'],
    ]);
    expect(logged()).toContain(`cards: wrote 2 places to ${file}, 1 with a page`);
  });
});

describe('cards save', () => {
  const entry = (id: string, cardLine: string | null): Entry => ({
    id,
    name: id,
    shortDescription: '',
    cardLine,
    cardName: null,
    stored: { cardLine: null, cardName: null },
  });
  const review = (entries: unknown) => {
    const file = join(cwd, 'review.json');
    writeFileSync(file, JSON.stringify(entries));
    return file;
  };
  const prod = (vars = 'TURSO_DATABASE_URL=libsql://prod-db.turso.io\nTURSO_AUTH_TOKEN=t\n') =>
    writeFileSync(join(cwd, '.env.prod'), vars);

  it('writes every line in one batch once the owner says yes, and names any left alone', async () => {
    prod();
    fakes.answer.mockResolvedValue(' Y ');
    fakes.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 0 }]);
    await main(['save', review([entry('cove', 'A cove.'), entry('rock', 'A rock.')])]);
    expect(fakes.connect).toHaveBeenCalledWith({
      url: 'libsql://prod-db.turso.io',
      authToken: 't',
    });
    expect(fakes.batch.mock.calls[0][0]).toHaveLength(2);
    expect(fakes.batch.mock.calls[0][1]).toBe('write');
    expect(logged()).toContain('cards: saved 1 places');
    expect(logged()).toContain(
      'cards: left alone, gone from the catalog or edited since the draft: rock',
    );
  });

  it('saves nothing unless the owner says yes', async () => {
    prod();
    fakes.answer.mockResolvedValue('');
    await main(['save', review([entry('cove', 'A cove.')])]);
    expect(fakes.batch).not.toHaveBeenCalled();
    expect(logged()).toContain('cards: nothing saved');
  });

  it('saves nothing from a file with a problem, and exits 1', async () => {
    await main(['save', review([entry('cove', null)])]);
    expect(process.exitCode).toBe(1);
    expect(fakes.answer).not.toHaveBeenCalled();
  });

  it("needs production's env file, with its URL", async () => {
    const file = review([entry('cove', 'A cove.')]);
    await expect(main(['save', file])).rejects.toThrow('cards: no .env.prod');
    prod('TURSO_AUTH_TOKEN=t\n');
    await expect(main(['save', file])).rejects.toThrow(
      'cards: .env.prod has no TURSO_DATABASE_URL',
    );
  });

  it('saves only the dog rules pages kept, and checks the file first', async () => {
    prod();
    fakes.answer.mockResolvedValue('y');
    fakes.batch.mockResolvedValue([{ rowsAffected: 1 }]);
    const dogs = (dogRulesUrl: string | null): DogEntry => ({
      id: dogRulesUrl ?? 'none',
      name: 'Trail',
      city: 'A',
      dogRulesUrl,
    });
    const file = join(cwd, 'dogs.json');
    writeFileSync(file, JSON.stringify([dogs('https://parks.gov/dogs'), dogs(null)]));
    await main(['dogs', 'save', file]);
    expect(fakes.batch.mock.calls[0][0]).toHaveLength(1);
    writeFileSync(file, JSON.stringify([dogs('https://www.yelp.com/x')]));
    await main(['dogs', 'save', file]);
    expect(process.exitCode).toBe(1);
    expect(fakes.batch).toHaveBeenCalledTimes(1);
  });
});

describe('main', () => {
  it('refuses a step it has no name for', async () => {
    await expect(main(['publish'])).rejects.toThrow('usage: npm run cards -- draft');
    await expect(main(['dogs'])).rejects.toThrow('usage');
  });
});
