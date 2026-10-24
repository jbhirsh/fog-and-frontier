import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloClient } from './apolloClient';
import { startingActivityIds, suggestTripActivities } from './tripIdeas';

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

function reply(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('suggestTripActivities (#78)', () => {
  it('sends the request and exclusions, and flattens each idea', async () => {
    let vars: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        vars = (JSON.parse(opts.body) as { variables: unknown }).variables;
        return Promise.resolve(
          reply({
            data: {
              suggestTripActivities: {
                __typename: 'SuggestTripActivitiesPayload',
                suggestions: [
                  {
                    __typename: 'TripSuggestion',
                    activityId: 'ff',
                    reason: 'dogs welcome',
                    activity: {
                      __typename: 'Activity',
                      id: 'ff',
                      name: 'Fort Funston',
                      category: 'scenic',
                      location: { __typename: 'Location', city: 'San Francisco' },
                    },
                  },
                ],
              },
            },
          }),
        );
      }),
    );
    const ideas = await suggestTripActivities('dogs', ['x']);
    expect(vars).toEqual({ input: { prompt: 'dogs', excludeActivityIds: ['x'] } });
    expect(ideas).toEqual([
      {
        activityId: 'ff',
        reason: 'dogs welcome',
        name: 'Fort Funston',
        category: 'scenic',
        city: 'San Francisco',
      },
    ]);
  });

  it('reads an empty answer as no ideas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reply({ data: null }))),
    );
    expect(await suggestTripActivities('dogs', [])).toEqual([]);
  });
});

describe('startingActivityIds (#78)', () => {
  it('is the ones brought in, then the picks, once each', () => {
    expect(startingActivityIds(['a', 'b'], ['c', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(startingActivityIds([], [])).toEqual([]);
  });
});
