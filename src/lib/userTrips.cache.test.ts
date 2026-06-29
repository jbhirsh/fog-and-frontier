import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from './apolloClient';
import {
  addActivityToTrip,
  castVote,
  createTrip,
  markTripPast,
  useTrip,
} from './userTrips';
import { ACTIVITIES_QUERY, COMPLETED_QUERY, TRIP_QUERY } from './gqlDocs';
import { toActivityRow } from '../test/render';
import { completedHike, muirWoods } from '../test/fixtures';

// These tests exercise the Apollo client cache/optimistic logic that the trip
// data layer adds on top of the apolloClient singleton — the same client the
// app wires into ApolloProvider in prod. We render/mutate against that singleton
// and stub fetch so the GraphQL ops resolve, then assert the cache state
// end-to-end. Mirrors the pattern in src/lib/userCompleted.test.ts.

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// GraphQL transport: resolver errors return HTTP 200 + `errors[]`; Apollo
// surfaces them as CombinedGraphQLErrors (which `appCodeOf` reads).
function gqlErrorResponse(
  message: string,
  extensions: Record<string, unknown>,
): Response {
  return jsonResponse({ errors: [{ message, extensions }] });
}

type Responder = (
  vars: Record<string, unknown>,
) => Response | Promise<Response>;

// Routes the stubbed fetch by GraphQL operationName so a single test can answer
// the seed read, the mutation, and any awaited refetch.
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ApolloProvider, { client: apolloClient, children });
}

// ---- GraphQL row builders (camelCase/ISO, with the __typenames the cache
// needs). Untyped on purpose — they're fed straight into the fetch JSON. ----

function voteJson(tripActivityId: string, memberEmail: string, value: number) {
  return { __typename: 'TripVote', tripActivityId, memberEmail, value };
}

function snapshotJson(over: Record<string, unknown> = {}) {
  return {
    __typename: 'ActivitySnapshot',
    id: 'act1',
    name: 'Pfeiffer Beach',
    shortDescription: 'Purple sand cove',
    longDescription: null,
    category: 'food',
    region: 'central-coast',
    parkType: 'state',
    location: {
      __typename: 'Location',
      city: 'Big Sur',
      coords: { __typename: 'Coords', lat: 36.2, lng: -121.8 },
    },
    duration: 'Half Day',
    durationDetail: null,
    difficulty: null,
    dogFriendly: null,
    coverImage: 'http://img',
    galleryImages: null,
    allTrailsUrl: null,
    allTrailsRating: null,
    hikeDistanceMiles: null,
    hikeElevationFeet: null,
    cuisine: 'Californian',
    priceRange: '$$$',
    hours: 'Wed–Sun',
    reservationUrl: 'http://resy',
    menuUrl: 'http://menu',
    dietary: ['vegetarian'],
    completed: null,
    completedDate: null,
    notes: null,
    ...over,
  };
}

function tripActivityJson(over: Record<string, unknown> = {}) {
  return {
    __typename: 'TripActivity',
    id: 'ta1',
    tripId: 'trip1',
    activityId: 'act1',
    addedByEmail: 'alice@x.com',
    addedAt: '2025-06-02T09:30:00.000Z',
    dayIndex: 0,
    startTime: '09:00',
    displayOrder: 2,
    snapshot: snapshotJson(),
    ...over,
  };
}

function memberJson(over: Record<string, unknown> = {}) {
  return {
    __typename: 'TripMember',
    email: 'alice@x.com',
    displayName: 'Alice',
    addedByEmail: 'alice@x.com',
    addedAt: '2025-06-01T12:00:00.000Z',
    isCreator: true,
    ...over,
  };
}

function inviteJson(over: Record<string, unknown> = {}) {
  return {
    __typename: 'TripInvite',
    inviteToken: 'tok',
    invitedEmail: 'bob@x.com',
    invitedByEmail: 'alice@x.com',
    invitedAt: '2025-06-03T00:00:00.000Z',
    ...over,
  };
}

function tripJson(over: Record<string, unknown> = {}) {
  return {
    trip: {
      __typename: 'Trip',
      id: 'trip1',
      creatorEmail: 'alice@x.com',
      title: 'Big Sur',
      description: null,
      startDate: '2025-07-01',
      endDate: '2025-07-03',
      coverImageUrl: null,
      status: 'voting',
      createdAt: '2025-06-01T12:00:00.000Z',
      markedPastAt: null,
      activities: [],
      members: [],
      invites: [],
      votes: [],
      ...over,
    },
  };
}

function readVotes(optimistic = false) {
  const data = apolloClient.cache.readQuery({
    query: TRIP_QUERY,
    variables: { id: 'trip1' },
    optimistic,
  });
  return data?.trip?.votes ?? [];
}

async function seedTrip(): Promise<void> {
  // Populate the cache via the network path so castVote's cache.updateQuery has
  // a `prev` to surgically rewrite.
  await apolloClient.query({ query: TRIP_QUERY, variables: { id: 'trip1' } });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

describe('castVote (optimistic + cache rewrite)', () => {
  it('value 1 upserts the caller vote, replacing a prior same-member vote (case-insensitive)', async () => {
    installFetch({
      TripDetail: () =>
        jsonResponse({
          data: tripJson({
            votes: [
              voteJson('ta1', 'Alice@x.com', -1), // prior downvote, mixed case
              voteJson('ta1', 'bob@x.com', 1),
              voteJson('ta2', 'alice@x.com', 1),
            ],
          }),
        }),
      CastVote: () =>
        jsonResponse({
          data: {
            castVote: {
              __typename: 'CastVotePayload',
              vote: voteJson('ta1', 'alice@x.com', 1),
            },
          },
        }),
    });
    await seedTrip();

    await castVote('trip1', 'ta1', 1, 'alice@x.com');

    const votes = readVotes();
    const aliceTa1 = votes.filter(
      (v) => v.tripActivityId === 'ta1' && v.memberEmail.toLowerCase() === 'alice@x.com',
    );
    expect(aliceTa1).toEqual([
      { __typename: 'TripVote', tripActivityId: 'ta1', memberEmail: 'alice@x.com', value: 1 },
    ]);
    // Other member + the same member's vote on another candidate are untouched.
    expect(votes).toContainEqual(voteJson('ta1', 'bob@x.com', 1));
    expect(votes).toContainEqual(voteJson('ta2', 'alice@x.com', 1));
  });

  it('value -1 upserts a downvote for the caller', async () => {
    installFetch({
      TripDetail: () => jsonResponse({ data: tripJson({ votes: [] }) }),
      CastVote: () =>
        jsonResponse({
          data: {
            castVote: {
              __typename: 'CastVotePayload',
              vote: voteJson('ta1', 'alice@x.com', -1),
            },
          },
        }),
    });
    await seedTrip();

    await castVote('trip1', 'ta1', -1, 'alice@x.com');

    expect(readVotes()).toEqual([voteJson('ta1', 'alice@x.com', -1)]);
  });

  it('value 0 removes the caller vote', async () => {
    installFetch({
      TripDetail: () =>
        jsonResponse({
          data: tripJson({
            votes: [voteJson('ta1', 'alice@x.com', 1), voteJson('ta1', 'bob@x.com', 1)],
          }),
        }),
      CastVote: () =>
        jsonResponse({
          data: { castVote: { __typename: 'CastVotePayload', vote: null } },
        }),
    });
    await seedTrip();

    await castVote('trip1', 'ta1', 0, 'alice@x.com');

    const votes = readVotes();
    expect(
      votes.some(
        (v) => v.tripActivityId === 'ta1' && v.memberEmail.toLowerCase() === 'alice@x.com',
      ),
    ).toBe(false);
    expect(votes).toContainEqual(voteJson('ta1', 'bob@x.com', 1));
  });

  it('shows the optimistic vote immediately, then reconciles on the server result', async () => {
    const pending = deferred<Response>();
    installFetch({
      TripDetail: () => jsonResponse({ data: tripJson({ votes: [] }) }),
      CastVote: () => pending.promise,
    });
    await seedTrip();

    const inFlight = castVote('trip1', 'ta1', 1, 'carol@x.com');

    // The optimistic layer reflects the vote while the request is in flight.
    await waitFor(() =>
      expect(readVotes(true)).toContainEqual(voteJson('ta1', 'carol@x.com', 1)),
    );
    // The non-optimistic store stays empty until the server responds.
    expect(readVotes(false)).toEqual([]);

    pending.resolve(
      jsonResponse({
        data: {
          castVote: {
            __typename: 'CastVotePayload',
            vote: voteJson('ta1', 'carol@x.com', 1),
          },
        },
      }),
    );
    await inFlight;

    await waitFor(() =>
      expect(readVotes(false)).toContainEqual(voteJson('ta1', 'carol@x.com', 1)),
    );
  });
});

describe('markTripPast completion write-through', () => {
  it('mirrors transitionTrip results into the COMPLETED cache + Activity.completed', async () => {
    apolloClient.cache.writeQuery({
      query: ACTIVITIES_QUERY,
      data: { activities: [toActivityRow(muirWoods), toActivityRow(completedHike)] },
    });
    installFetch({
      TransitionTrip: () =>
        jsonResponse({
          data: {
            transitionTrip: {
              __typename: 'TripTransitionPayload',
              ok: true,
              status: 'past',
              kept: null,
              markedPastAt: '2025-06-10T08:00:00.000Z',
              completedActivityIds: [muirWoods.id],
              uncompletedActivityIds: [completedHike.id],
            },
          },
        }),
    });

    const res = await markTripPast('trip1', [muirWoods.id]);
    expect(res.marked_past_at).toBe(Date.parse('2025-06-10T08:00:00.000Z'));
    expect(res.completed_activity_ids).toEqual([muirWoods.id]);
    expect(res.uncompleted_activity_ids).toEqual([completedHike.id]);

    // COMPLETED_QUERY cache gets both write-through rows (eligible-but-unchecked
    // gets an explicit false to override a stale baseline).
    const completed =
      apolloClient.cache.readQuery({ query: COMPLETED_QUERY })?.completed ?? [];
    expect(completed).toContainEqual({
      __typename: 'CompletedEntry',
      id: muirWoods.id,
      completed: true,
    });
    expect(completed).toContainEqual({
      __typename: 'CompletedEntry',
      id: completedHike.id,
      completed: false,
    });

    // Activity.completed baseline is mirrored too, so badges update w/o refetch.
    const activities =
      apolloClient.cache.readQuery({ query: ACTIVITIES_QUERY })?.activities ?? [];
    expect(activities.find((a) => a.id === muirWoods.id)?.completed).toBe(true);
    expect(activities.find((a) => a.id === completedHike.id)?.completed).toBe(false);
  });
});

describe('addActivityToTrip appCode branching', () => {
  it('success → { alreadyOnTrip:false, tripPast:false }', async () => {
    installFetch({
      AddTripActivity: () =>
        jsonResponse({
          data: {
            addTripActivity: {
              __typename: 'AddTripActivityPayload',
              tripActivity: { __typename: 'TripActivity', id: 'ta1' },
            },
          },
        }),
    });
    expect(await addActivityToTrip('trip1', 'act1')).toEqual({
      alreadyOnTrip: false,
      tripPast: false,
    });
  });

  it("409 CONFLICT appCode 'trip_past' → { tripPast:true }", async () => {
    installFetch({
      AddTripActivity: () =>
        gqlErrorResponse('trip is past', { code: 'CONFLICT', appCode: 'trip_past' }),
    });
    expect(await addActivityToTrip('trip1', 'act1')).toEqual({
      alreadyOnTrip: false,
      tripPast: true,
    });
  });

  it("409 CONFLICT appCode 'duplicate' → { alreadyOnTrip:true }", async () => {
    installFetch({
      AddTripActivity: () =>
        gqlErrorResponse('already on trip', { code: 'CONFLICT', appCode: 'duplicate' }),
    });
    expect(await addActivityToTrip('trip1', 'act1')).toEqual({
      alreadyOnTrip: true,
      tripPast: false,
    });
  });

  it('any other error rethrows (not silently treated as alreadyOnTrip)', async () => {
    installFetch({
      AddTripActivity: () => gqlErrorResponse('boom', { code: 'NOT_FOUND' }),
    });
    await expect(addActivityToTrip('trip1', 'act1')).rejects.toThrow();
  });
});

describe('boundary mappers — rowToTrip + createTrip input', () => {
  it('rowToTrip: ISO→epoch, Date/LocalTime passthrough (no day-shift), snake_case', async () => {
    installFetch({
      TripDetail: () =>
        jsonResponse({
          data: tripJson({
            markedPastAt: '2025-06-10T08:00:00.000Z',
            activities: [tripActivityJson()],
            members: [memberJson()],
            invites: [inviteJson()],
            votes: [voteJson('ta1', 'alice@x.com', 1)],
          }),
        }),
    });
    const { result } = renderHook(() => useTrip('trip1'), { wrapper });
    await waitFor(() => expect(result.current.trip).not.toBeNull());
    const trip = result.current.trip!;

    // DateTimeISO → epoch ms.
    expect(trip.created_at).toBe(Date.parse('2025-06-01T12:00:00.000Z'));
    expect(trip.marked_past_at).toBe(Date.parse('2025-06-10T08:00:00.000Z'));
    // Date scalar stays 'YYYY-MM-DD' — not parsed, so no day-shift.
    expect(trip.start_date).toBe('2025-07-01');
    expect(trip.end_date).toBe('2025-07-03');

    const ta = trip.activities[0];
    expect(ta.trip_id).toBe('trip1');
    expect(ta.activity_id).toBe('act1');
    expect(ta.added_at).toBe(Date.parse('2025-06-02T09:30:00.000Z'));
    expect(ta.start_time).toBe('09:00'); // LocalTime passthrough
    expect(ta.display_order).toBe(2);
    expect(ta.snapshot?.parkType).toBe('state');
    expect(ta.snapshot?.cuisine).toBe('Californian');
    expect(ta.snapshot?.priceRange).toBe('$$$');

    expect(trip.members[0]).toEqual({
      email: 'alice@x.com',
      display_name: 'Alice',
      added_by_email: 'alice@x.com',
      added_at: Date.parse('2025-06-01T12:00:00.000Z'),
      is_creator: true,
    });
    expect(trip.invites[0]).toEqual({
      invite_token: 'tok',
      invited_email: 'bob@x.com',
      invited_by_email: 'alice@x.com',
      invited_at: Date.parse('2025-06-03T00:00:00.000Z'),
    });
    expect(trip.votes).toEqual([
      { trip_activity_id: 'ta1', member_email: 'alice@x.com', value: 1 },
    ]);
  });

  it('createTrip: snake_case dates → camelCase input unchanged (no day-shift)', async () => {
    let captured: { startDate?: string; endDate?: string } | undefined;
    installFetch({
      CreateTrip: (vars) => {
        captured = (vars as { input: { startDate: string; endDate: string } }).input;
        return jsonResponse({
          data: {
            createTrip: {
              __typename: 'CreateTripPayload',
              trip: { __typename: 'Trip', id: 'trip9' },
            },
          },
        });
      },
      TripsList: () => jsonResponse({ data: { trips: [] } }),
    });

    const { id } = await createTrip({
      title: 'T',
      start_date: '2025-07-01',
      end_date: '2025-07-03',
    });

    expect(id).toBe('trip9');
    expect(captured?.startDate).toBe('2025-07-01');
    expect(captured?.endDate).toBe('2025-07-03');
  });
});
