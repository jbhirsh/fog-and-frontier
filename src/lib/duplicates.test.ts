import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloClient } from './apolloClient';
import { checkDuplicates, unacknowledgedHigh, type DuplicateMatch } from './duplicates';
import { muirWoods } from '../test/fixtures';

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

describe('checkDuplicates (#17)', () => {
  it("asks the server about the activity's name and pin, and maps the matches", async () => {
    let vars: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        vars = (JSON.parse(opts.body) as { variables: Record<string, unknown> }).variables;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                checkDuplicate: [
                  {
                    __typename: 'DuplicateMatch',
                    id: 'muir',
                    name: 'Muir Woods',
                    city: 'Mill Valley',
                    distanceMeters: 40,
                    confidence: 'high',
                  },
                ],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );
    const found = await checkDuplicates(muirWoods);
    expect(vars).toEqual({
      name: muirWoods.name,
      lat: muirWoods.location.coords.lat,
      lng: muirWoods.location.coords.lng,
    });
    expect(found).toEqual([
      {
        id: 'muir',
        name: 'Muir Woods',
        city: 'Mill Valley',
        distanceMeters: 40,
        confidence: 'high',
      },
    ]);
  });
});

describe('checkDuplicates with nothing back', () => {
  it('reads an empty answer as no matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    expect(await checkDuplicates(muirWoods)).toEqual([]);
  });
});

describe('unacknowledgedHigh (#17)', () => {
  const m = (id: string, confidence: 'high' | 'possible'): DuplicateMatch => ({
    id,
    name: id,
    city: 'X',
    distanceMeters: 0,
    confidence,
  });

  it('is the high matches the owner has not said are different', () => {
    const found = [m('a', 'high'), m('b', 'high'), m('c', 'possible')];
    expect(unacknowledgedHigh(found, []).map((x) => x.id)).toEqual(['a', 'b']);
    expect(unacknowledgedHigh(found, ['a']).map((x) => x.id)).toEqual(['b']);
    expect(unacknowledgedHigh(found, ['a', 'b'])).toEqual([]);
  });
});
