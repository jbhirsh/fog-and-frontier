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
  coverCredit: 'Photo: Jo, CC BY 4.0, via Wikimedia Commons',
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
  sourceUrl: 'https://www.instagram.com/reel/Ddl9QKSv0D7/',
  completed: true,
  completedDate: '2025-11-02',
  notes: 'Book well ahead.',
  contributors: ['tarun@example.com', 'owner@example.com'],
  costTier: '$$',
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
      sourceUrl: 'https://www.instagram.com/reel/Ddl9QKSv0D7/',
      completed: true,
      completedDate: '2025-11-02',
      coverCredit: 'Photo: Jo, CC BY 4.0, via Wikimedia Commons',
      contributors: ['tarun@example.com', 'owner@example.com'],
      costTier: '$$',
    });
  });

  it('maps a missing coverCredit to undefined and sends it as null', async () => {
    const plain: Activity = { ...richActivity, coverCredit: undefined };
    expect(rowToActivity(toActivityRow(plain)).coverCredit).toBeUndefined();
    let captured: Record<string, unknown> | undefined;
    installFetch({
      SaveActivity: (vars) => {
        captured = (vars as { input: { activity: Record<string, unknown> } }).input.activity;
        return jsonResponse({
          data: {
            saveActivity: {
              __typename: 'SaveActivityPayload',
              activity: { __typename: 'Activity', id: plain.id },
            },
          },
        });
      },
      Activities: () => jsonResponse({ data: { activities: [] } }),
    });
    await saveUserActivity(plain);
    expect(captured).toHaveProperty('coverCredit', null);
  });

  // Null asks the server to keep the stored list (#9): a signed-out read or a
  // new activity has none, and saving must not wipe who added it.
  it('maps missing contributors to undefined and sends them as null', async () => {
    const plain: Activity = { ...richActivity, contributors: undefined };
    expect(rowToActivity(toActivityRow(plain)).contributors).toBeUndefined();
    let captured: Record<string, unknown> | undefined;
    installFetch({
      SaveActivity: (vars) => {
        captured = (vars as { input: { activity: Record<string, unknown> } }).input.activity;
        return jsonResponse({
          data: {
            saveActivity: {
              __typename: 'SaveActivityPayload',
              activity: { __typename: 'Activity', id: plain.id },
            },
          },
        });
      },
      Activities: () => jsonResponse({ data: { activities: [] } }),
    });
    await saveUserActivity(plain);
    expect(captured).toHaveProperty('contributors', null);
  });

  it('creates or edits as asked, and returns the id the server used (#17)', async () => {
    const inputs: Record<string, unknown>[] = [];
    installFetch({
      SaveActivity: (vars) => {
        inputs.push((vars as { input: Record<string, unknown> }).input);
        return jsonResponse({
          data: {
            saveActivity: {
              __typename: 'SaveActivityPayload',
              activity: { __typename: 'Activity', id: `${richActivity.id}-2` },
            },
          },
        });
      },
      Activities: () => jsonResponse({ data: { activities: [] } }),
    });
    expect(await saveUserActivity(richActivity)).toBe(`${richActivity.id}-2`);
    await saveUserActivity(richActivity, { create: true });
    await saveUserActivity(richActivity, { create: true, allowDuplicate: true });
    expect(inputs[0]).not.toHaveProperty('create');
    expect(inputs[0]).not.toHaveProperty('allowDuplicate');
    expect(inputs[1]).toHaveProperty('create', true);
    expect(inputs[1]).not.toHaveProperty('allowDuplicate');
    expect(inputs[2]).toMatchObject({ create: true, allowDuplicate: true });
  });
});
