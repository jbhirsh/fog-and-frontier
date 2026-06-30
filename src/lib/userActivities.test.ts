import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { rowToActivity, saveUserActivity } from './userActivities';
import { toActivityRow } from '../test/render';

// Boundary-mapper round-trip for the catalog Activity: GraphQL row (camelCase)
// → domain → ActivityInput (camelCase). `rowToActivity` is exported and tested
// directly; the private `activityToInput` is exercised through saveUserActivity
// by capturing the GraphQL variables it sends (behavior, not implementation).

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

type Responder = (
  vars: Record<string, unknown>,
) => Response | Promise<Response>;

function installFetch(routes: Record<string, Responder>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body) as {
        operationName?: string;
        variables?: Record<string, unknown>;
      };
      const responder = body.operationName
        ? routes[body.operationName]
        : undefined;
      if (!responder) return Promise.resolve(jsonResponse({ data: {} }));
      return Promise.resolve(responder(body.variables ?? {}));
    }),
  );
}

// A maximal activity: parkType + every restaurant field + completed/completedDate
// + gallery/hike fields, so the round-trip exercises the full field set.
const richActivity: Activity = {
  id: 'act-rich',
  name: 'Manresa',
  shortDescription: 'Tasting menu',
  longDescription: 'A multi-course Californian tasting menu.',
  category: 'food',
  region: 'central-coast',
  parkType: 'state',
  location: { city: 'Big Sur', coords: { lat: 36.2, lng: -121.8 } },
  duration: 'Half Day',
  durationDetail: '~1h drive each way',
  difficulty: 'easy',
  dogFriendly: false,
  coverImage: 'http://img',
  galleryImages: ['http://g1', 'http://g2'],
  allTrailsUrl: 'http://alltrails',
  allTrailsRating: 4.6,
  hikeDistanceMiles: 5.1,
  hikeElevationFeet: 1200,
  cuisine: 'Californian',
  priceRange: '$$$',
  hours: 'Wed–Sun',
  reservationUrl: 'http://resy',
  menuUrl: 'http://menu',
  dietary: ['vegetarian', 'vegan'],
  completed: true,
  completedDate: '2025-11-02',
  notes: 'Book well ahead.',
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

describe('rowToActivity ↔ activityToInput round-trip', () => {
  it('GraphQL row → domain preserves parkType, restaurant fields, completedDate', () => {
    const domain = rowToActivity(toActivityRow(richActivity));
    expect(domain).toEqual(richActivity);
  });

  it('domain → ActivityInput emits camelCase values incl. parkType + restaurant fields', async () => {
    let capturedInput:
      | { id: string; activity: Record<string, unknown> }
      | undefined;
    installFetch({
      SaveActivity: (vars) => {
        capturedInput = (
          vars as { input: { id: string; activity: Record<string, unknown> } }
        ).input;
        return jsonResponse({
          data: {
            saveActivity: {
              __typename: 'SaveActivityPayload',
              activity: { __typename: 'Activity', id: richActivity.id },
            },
          },
        });
      },
      // saveUserActivity awaits a catalog refetch after the write.
      Activities: () => jsonResponse({ data: { activities: [] } }),
    });

    // Feed the domain object produced by the row mapper — a true round-trip.
    await saveUserActivity(rowToActivity(toActivityRow(richActivity)));

    expect(capturedInput?.id).toBe(richActivity.id);
    expect(capturedInput?.activity).toMatchObject({
      name: 'Manresa',
      shortDescription: 'Tasting menu',
      category: 'food',
      region: 'central-coast',
      parkType: 'state',
      location: { city: 'Big Sur', coords: { lat: 36.2, lng: -121.8 } },
      duration: 'Half Day',
      cuisine: 'Californian',
      priceRange: '$$$',
      hours: 'Wed–Sun',
      reservationUrl: 'http://resy',
      menuUrl: 'http://menu',
      dietary: ['vegetarian', 'vegan'],
      completed: true,
      completedDate: '2025-11-02',
    });
  });
});
