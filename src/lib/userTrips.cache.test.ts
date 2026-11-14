import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from './apolloClient';
import { AuthCtx } from './authShim';
import {
  addActivityToTrip,
  assignSlot,
  castVote,
  claimInvite,
  createTrip,
  deleteTrip,
  fetchUsers,
  inviteMember,
  markTripPast,
  patchTrip,
  removeMember,
  removeTripActivity,
  revertToVoting,
  revokeInvite,
  setDisplayOrder,
  setStartTimes,
  transitionToPlanning,
  useTrip,
  useTripsList,
} from './userTrips';
import {
  ACTIVITIES_QUERY,
  ADD_TRIP_ACTIVITY,
  ASSIGN_SLOT,
  CLAIM_INVITE,
  COMPLETED_QUERY,
  CREATE_TRIP,
  DELETE_TRIP,
  INVITE_MEMBER,
  PATCH_TRIP,
  REMOVE_MEMBER,
  REMOVE_TRIP_ACTIVITY,
  REVOKE_INVITE,
  SET_DISPLAY_ORDER,
  TRANSITION_TRIP,
  TRIP_QUERY,
  TRIPS_QUERY,
  USERS_QUERY,
} from './gqlDocs';
import { toActivityRow } from '../test/render';
import { completedHike, muirWoods } from '../test/fixtures';
import { deferred } from '../test/deferred';

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
function gqlErrorResponse(message: string, extensions: Record<string, unknown>): Response {
  return jsonResponse({ errors: [{ message, extensions }] });
}

type Responder = (vars: Record<string, unknown>) => Response | Promise<Response>;

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
      const responder = body.operationName ? routes[body.operationName] : undefined;
      if (!responder) return Promise.resolve(jsonResponse({ data: {} }));
      return Promise.resolve(responder(body.variables ?? {}));
    }),
  );
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
    costTier: null,
    hours: 'Wed–Sun',
    reservationUrl: 'http://resy',
    menuUrl: 'http://menu',
    sourceUrl: null,
    dogRulesUrl: null,
    cardLine: null,
    cardName: null,
    dietary: ['vegetarian'],
    completed: null,
    completedDate: null,
    notes: null,
    contributors: null,
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
  vi.restoreAllMocks();
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
    await waitFor(() => expect(readVotes(true)).toContainEqual(voteJson('ta1', 'carol@x.com', 1)));
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

    await waitFor(() => expect(readVotes(false)).toContainEqual(voteJson('ta1', 'carol@x.com', 1)));
  });
});

describe('markTripPast completion write-through', () => {
  it('mirrors transitionTrip results into the COMPLETED cache + Activity.completed', async () => {
    apolloClient.cache.writeQuery({
      query: ACTIVITIES_QUERY,
      data: { activities: [toActivityRow(muirWoods), toActivityRow(completedHike)] },
    });
    // The completed list is loaded (as it is wherever badges show); the mirror
    // only merges into a cached list, never builds one from these ids alone.
    apolloClient.cache.writeQuery({
      query: COMPLETED_QUERY,
      data: { completed: [] },
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
    const completed = apolloClient.cache.readQuery({ query: COMPLETED_QUERY })?.completed ?? [];
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
    const activities = apolloClient.cache.readQuery({ query: ACTIVITIES_QUERY })?.activities ?? [];
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

describe('setStartTimes (#294)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a day’s new times in one mutation', async () => {
    let sent: Record<string, unknown> | undefined;
    installFetch({
      SetStartTimes: (vars) => {
        sent = vars;
        return jsonResponse({
          data: {
            setStartTimes: {
              __typename: 'SetStartTimesPayload',
              tripActivities: [
                { __typename: 'TripActivity', id: 'a' },
                { __typename: 'TripActivity', id: 'b' },
              ],
            },
          },
        });
      },
    });
    await setStartTimes('trip-1', [
      { id: 'a', start_time: '13:00' },
      { id: 'b', start_time: '09:00' },
    ]);
    expect(sent).toEqual({
      input: {
        tripId: 'trip-1',
        times: [
          { taId: 'a', startTime: '13:00' },
          { taId: 'b', startTime: '09:00' },
        ],
      },
    });
  });
});

// ---- the rest of the data layer: each call's variables, and what it returns ----

// Answers apolloClient.mutate with `data`, recording each call's options.
function stubMutate(data: unknown = {}) {
  return vi.spyOn(apolloClient, 'mutate').mockResolvedValue({ data });
}

function signedOutWrapper({ children }: { children: ReactNode }) {
  return createElement(AuthCtx.Provider, {
    value: { isLoaded: false, email: null, name: null },
    children: wrapper({ children }),
  });
}

function tripListJson(over: Record<string, unknown> = {}) {
  return {
    __typename: 'TripListItem',
    id: 'trip1',
    creatorEmail: 'alice@x.com',
    title: 'Big Sur',
    description: 'Coast',
    startDate: '2025-07-01',
    endDate: '2025-07-03',
    coverImageUrl: 'http://cover',
    status: 'planning',
    createdAt: '2025-06-01T12:00:00.000Z',
    markedPastAt: null,
    scheduledCount: 3,
    unscheduledCount: 1,
    ...over,
  };
}

describe('useTripsList', () => {
  it('maps each trip to its list item', async () => {
    installFetch({
      TripsList: () =>
        jsonResponse({
          data: {
            trips: [
              tripListJson(),
              tripListJson({
                id: 'trip2',
                description: null,
                coverImageUrl: null,
                status: 'past',
                markedPastAt: '2025-07-04T00:00:00.000Z',
              }),
            ],
          },
        }),
    });
    const { result } = renderHook(() => useTripsList(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.trips).toEqual([
      {
        id: 'trip1',
        creator_email: 'alice@x.com',
        title: 'Big Sur',
        description: 'Coast',
        start_date: '2025-07-01',
        end_date: '2025-07-03',
        cover_image_url: 'http://cover',
        status: 'planning',
        created_at: Date.parse('2025-06-01T12:00:00.000Z'),
        marked_past_at: null,
        scheduled_count: 3,
        unscheduled_count: 1,
      },
      {
        id: 'trip2',
        creator_email: 'alice@x.com',
        title: 'Big Sur',
        description: null,
        start_date: '2025-07-01',
        end_date: '2025-07-03',
        cover_image_url: null,
        status: 'past',
        created_at: Date.parse('2025-06-01T12:00:00.000Z'),
        marked_past_at: Date.parse('2025-07-04T00:00:00.000Z'),
        scheduled_count: 3,
        unscheduled_count: 1,
      },
    ]);
  });

  it('reports a signed-out caller as unauthorized', async () => {
    installFetch({
      TripsList: () => gqlErrorResponse('sign in', { code: 'UNAUTHENTICATED' }),
    });
    const { result } = renderHook(() => useTripsList(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('unauthorized'));
    expect(result.current.trips).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('waits for the session before asking, and stays loading meanwhile', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTripsList(), { wrapper: signedOutWrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.trips).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reload asks the server again', async () => {
    let calls = 0;
    installFetch({
      TripsList: () => {
        calls++;
        return jsonResponse({ data: { trips: [tripListJson({ title: `Trip ${calls}` })] } });
      },
    });
    const { result } = renderHook(() => useTripsList(), { wrapper });
    await waitFor(() => expect(result.current.trips[0]?.title).toBe('Trip 1'));
    await result.current.reload();
    await waitFor(() => expect(result.current.trips[0]?.title).toBe('Trip 2'));
  });
});

describe('useTrip load states', () => {
  it('maps a null trip (missing, or not a member) to not-found', async () => {
    installFetch({ TripDetail: () => jsonResponse({ data: { trip: null } }) });
    const { result } = renderHook(() => useTrip('trip1'), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('not-found'));
    expect(result.current.trip).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('maps an UNAUTHENTICATED error to unauthorized', async () => {
    installFetch({
      TripDetail: () => gqlErrorResponse('sign in', { code: 'UNAUTHENTICATED' }),
    });
    const { result } = renderHook(() => useTrip('trip1'), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('unauthorized'));
    expect(result.current.isLoading).toBe(false);
  });

  it('asks for the trip by its id, and is loading until it arrives', async () => {
    const asked: Record<string, unknown>[] = [];
    installFetch({
      TripDetail: (vars) => {
        asked.push(vars);
        return jsonResponse({ data: tripJson() });
      },
    });
    const { result } = renderHook(() => useTrip('trip1'), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.trip?.title).toBe('Big Sur'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(asked).toEqual([{ id: 'trip1' }]);
    // The optional fields absent from the row read as null.
    expect(result.current.trip).toMatchObject({
      description: null,
      cover_image_url: null,
      marked_past_at: null,
    });
  });

  it('maps a trip activity’s missing fields to null', async () => {
    installFetch({
      TripDetail: () =>
        jsonResponse({
          data: tripJson({
            activities: [
              tripActivityJson({
                activityId: null,
                dayIndex: null,
                startTime: null,
                snapshot: null,
              }),
              tripActivityJson({ id: 'ta2', dayIndex: 1 }),
            ],
            members: [memberJson({ displayName: null })],
            invites: [inviteJson({ invitedEmail: null })],
          }),
        }),
    });
    const { result } = renderHook(() => useTrip('trip1'), { wrapper });
    await waitFor(() => expect(result.current.trip).not.toBeNull());
    const trip = result.current.trip!;
    expect(trip.activities[0]).toMatchObject({
      activity_id: null,
      day_index: null,
      start_time: null,
      snapshot: null,
    });
    expect(trip.activities[1].day_index).toBe(1);
    expect(trip.members[0].display_name).toBeNull();
    expect(trip.invites[0].invited_email).toBeNull();
  });

  it('asks nothing without an id, and is not loading', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTrip(undefined), { wrapper });
    expect(result.current).toMatchObject({ trip: null, isLoading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the session before asking, and stays loading meanwhile', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTrip('trip1'), { wrapper: signedOutWrapper });
    expect(result.current).toMatchObject({ trip: null, isLoading: true, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reload asks the server again', async () => {
    let calls = 0;
    installFetch({
      TripDetail: () => {
        calls++;
        return jsonResponse({ data: tripJson({ title: `Trip ${calls}` }) });
      },
    });
    const { result } = renderHook(() => useTrip('trip1'), { wrapper });
    await waitFor(() => expect(result.current.trip?.title).toBe('Trip 1'));
    await result.current.reload();
    await waitFor(() => expect(result.current.trip?.title).toBe('Trip 2'));
  });
});

describe('createTrip input', () => {
  it('sends every field, refetching the trips list before it resolves', async () => {
    const mutate = stubMutate({ createTrip: { trip: { id: 'trip9' } } });
    await createTrip({
      title: 'T',
      start_date: '2025-07-01',
      end_date: '2025-07-03',
      description: 'D',
      cover_image_url: 'http://c',
      initial_activity_ids: ['a', 'b'],
      status: 'voting',
    });
    expect(mutate).toHaveBeenCalledWith({
      mutation: CREATE_TRIP,
      variables: {
        input: {
          title: 'T',
          startDate: '2025-07-01',
          endDate: '2025-07-03',
          description: 'D',
          coverImageUrl: 'http://c',
          initialActivityIds: ['a', 'b'],
          status: 'voting',
        },
      },
      refetchQueries: [{ query: TRIPS_QUERY }],
      awaitRefetchQueries: true,
    });
  });

  it('sends null for the fields left out', async () => {
    const mutate = stubMutate({ createTrip: { trip: { id: 'trip9' } } });
    await createTrip({ title: 'T', start_date: '2025-07-01', end_date: '2025-07-03' });
    expect(mutate.mock.calls[0][0].variables).toEqual({
      input: {
        title: 'T',
        startDate: '2025-07-01',
        endDate: '2025-07-03',
        description: null,
        coverImageUrl: null,
        initialActivityIds: null,
        status: null,
      },
    });
  });

  it('throws when the server returned no id', async () => {
    stubMutate({ createTrip: { trip: { id: '' } } });
    await expect(
      createTrip({ title: 'T', start_date: '2025-07-01', end_date: '2025-07-03' }),
    ).rejects.toThrow('create trip failed');
    stubMutate(null);
    await expect(
      createTrip({ title: 'T', start_date: '2025-07-01', end_date: '2025-07-03' }),
    ).rejects.toThrow('create trip failed');
  });
});

describe('patchTrip', () => {
  it('sends every field given, nulls included', async () => {
    const mutate = stubMutate();
    await patchTrip('trip1', {
      title: 'T',
      description: null,
      start_date: '2025-07-01',
      end_date: '2025-07-03',
      cover_image_url: null,
    });
    expect(mutate).toHaveBeenCalledWith({
      mutation: PATCH_TRIP,
      variables: {
        input: {
          id: 'trip1',
          patch: {
            title: 'T',
            description: null,
            startDate: '2025-07-01',
            endDate: '2025-07-03',
            coverImageUrl: null,
          },
        },
      },
    });
  });

  it('leaves out the keys not given, so a cover-only edit sends only the cover', async () => {
    const mutate = stubMutate();
    await patchTrip('trip1', { cover_image_url: 'http://c' });
    expect(mutate.mock.calls[0][0].variables).toStrictEqual({
      input: { id: 'trip1', patch: { coverImageUrl: 'http://c' } },
    });
    await patchTrip('trip1', { description: 'D' });
    expect(mutate.mock.calls[1][0].variables).toStrictEqual({
      input: { id: 'trip1', patch: { description: 'D' } },
    });
    await patchTrip('trip1', {});
    expect(mutate.mock.calls[2][0].variables).toStrictEqual({
      input: { id: 'trip1', patch: {} },
    });
  });
});

describe('trip mutations’ variables', () => {
  it('deleteTrip', async () => {
    const mutate = stubMutate();
    await deleteTrip('trip1');
    expect(mutate).toHaveBeenCalledWith({
      mutation: DELETE_TRIP,
      variables: { input: { id: 'trip1' } },
    });
  });

  it('addActivityToTrip', async () => {
    const mutate = stubMutate();
    await addActivityToTrip('trip1', 'act1');
    expect(mutate).toHaveBeenCalledWith({
      mutation: ADD_TRIP_ACTIVITY,
      variables: { input: { tripId: 'trip1', activityId: 'act1' } },
    });
  });

  it('addActivityToTrip rethrows a network error', async () => {
    const offline = new Error('offline');
    vi.spyOn(apolloClient, 'mutate').mockRejectedValue(offline);
    await expect(addActivityToTrip('trip1', 'act1')).rejects.toBe(offline);
  });

  it('assignSlot', async () => {
    const mutate = stubMutate();
    await assignSlot('ta1', { day_index: 2, start_time: '10:15', display_order: 4 });
    expect(mutate).toHaveBeenCalledWith({
      mutation: ASSIGN_SLOT,
      variables: { input: { taId: 'ta1', dayIndex: 2, startTime: '10:15', displayOrder: 4 } },
    });
  });

  it('removeTripActivity', async () => {
    const mutate = stubMutate();
    await removeTripActivity('ta1');
    expect(mutate).toHaveBeenCalledWith({
      mutation: REMOVE_TRIP_ACTIVITY,
      variables: { input: { taId: 'ta1' } },
    });
  });

  it('setDisplayOrder sends no day or time', async () => {
    const mutate = stubMutate();
    await setDisplayOrder('ta1', 3);
    expect(mutate).toHaveBeenCalledWith({
      mutation: SET_DISPLAY_ORDER,
      variables: { input: { taId: 'ta1', displayOrder: 3 } },
    });
  });

  it('transitionToPlanning', async () => {
    const mutate = stubMutate();
    await transitionToPlanning('trip1', ['ta1', 'ta2']);
    expect(mutate).toHaveBeenCalledWith({
      mutation: TRANSITION_TRIP,
      variables: { input: { id: 'trip1', to: 'planning', keptActivityIds: ['ta1', 'ta2'] } },
    });
  });

  it('revertToVoting', async () => {
    const mutate = stubMutate();
    await revertToVoting('trip1');
    expect(mutate).toHaveBeenCalledWith({
      mutation: TRANSITION_TRIP,
      variables: { input: { id: 'trip1', to: 'voting' } },
    });
  });

  it('removeMember', async () => {
    const mutate = stubMutate();
    await removeMember('trip1', 'bob@x.com');
    expect(mutate).toHaveBeenCalledWith({
      mutation: REMOVE_MEMBER,
      variables: { input: { tripId: 'trip1', email: 'bob@x.com' } },
    });
  });

  it('revokeInvite', async () => {
    const mutate = stubMutate();
    await revokeInvite('trip1', 'tok');
    expect(mutate).toHaveBeenCalledWith({
      mutation: REVOKE_INVITE,
      variables: { input: { tripId: 'trip1', token: 'tok' } },
    });
  });
});

describe('markTripPast', () => {
  it('sends the completed ids', async () => {
    const mutate = stubMutate({
      transitionTrip: {
        markedPastAt: '2025-06-10T08:00:00.000Z',
        completedActivityIds: [],
        uncompletedActivityIds: [],
      },
    });
    await markTripPast('trip1', ['act1']);
    expect(mutate).toHaveBeenCalledWith({
      mutation: TRANSITION_TRIP,
      variables: { input: { id: 'trip1', to: 'past', completedActivityIds: ['act1'] } },
    });
  });

  it('falls back to now and empty lists when the server says nothing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234_567);
    stubMutate({ transitionTrip: null });
    expect(await markTripPast('trip1', [])).toEqual({
      marked_past_at: 1_234_567,
      completed_activity_ids: [],
      uncompleted_activity_ids: [],
    });
    stubMutate(null);
    expect(await markTripPast('trip1', [])).toEqual({
      marked_past_at: 1_234_567,
      completed_activity_ids: [],
      uncompleted_activity_ids: [],
    });
  });
});

describe('fetchUsers', () => {
  it('asks the network and maps each user', async () => {
    const query = vi.spyOn(apolloClient, 'query').mockResolvedValue({
      data: {
        users: [
          { email: 'a@x.com', displayName: 'Ann' },
          { email: 'b@x.com', displayName: null },
        ],
      },
    });
    expect(await fetchUsers()).toEqual([
      { email: 'a@x.com', display_name: 'Ann' },
      { email: 'b@x.com', display_name: null },
    ]);
    expect(query).toHaveBeenCalledWith({ query: USERS_QUERY, fetchPolicy: 'network-only' });
  });

  it('returns no users when the query gave no data', async () => {
    vi.spyOn(apolloClient, 'query').mockResolvedValue({ data: undefined });
    expect(await fetchUsers()).toEqual([]);
  });
});

describe('inviteMember', () => {
  it('sends the invite and maps the one made', async () => {
    const mutate = stubMutate({
      inviteMember: {
        invite: {
          inviteToken: 'tok',
          invitedEmail: 'bob@x.com',
          invitedByEmail: 'alice@x.com',
          invitedAt: '2025-06-03T00:00:00.000Z',
        },
      },
    });
    expect(await inviteMember('trip1', 'bob@x.com')).toEqual({
      invite_token: 'tok',
      invited_email: 'bob@x.com',
      invited_by_email: 'alice@x.com',
      invited_at: Date.parse('2025-06-03T00:00:00.000Z'),
    });
    expect(mutate).toHaveBeenCalledWith({
      mutation: INVITE_MEMBER,
      variables: { input: { tripId: 'trip1', email: 'bob@x.com' } },
    });
  });

  it('fills an invite the server left out with blanks and now', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    stubMutate({ inviteMember: { invite: null } });
    expect(await inviteMember('trip1', '')).toEqual({
      invite_token: '',
      invited_email: null,
      invited_by_email: '',
      invited_at: 42,
    });
    stubMutate(null);
    expect(await inviteMember('trip1', '')).toEqual({
      invite_token: '',
      invited_email: null,
      invited_by_email: '',
      invited_at: 42,
    });
  });
});

describe('claimInvite', () => {
  it('sends the token and returns the trip joined', async () => {
    const mutate = stubMutate({ claimInvite: { tripId: 'trip1' } });
    expect(await claimInvite('tok')).toEqual({ trip_id: 'trip1' });
    expect(mutate).toHaveBeenCalledWith({
      mutation: CLAIM_INVITE,
      variables: { input: { inviteToken: 'tok' } },
    });
  });

  it('returns null when no trip was joined', async () => {
    stubMutate({ claimInvite: null });
    expect(await claimInvite('tok')).toBeNull();
    stubMutate({ claimInvite: { tripId: '' } });
    expect(await claimInvite('tok')).toBeNull();
    stubMutate(null);
    expect(await claimInvite('tok')).toBeNull();
  });
});

describe('castVote request', () => {
  type CastVoteOptions = {
    variables: unknown;
    optimisticResponse: unknown;
    update: (cache: typeof apolloClient.cache, result: { data?: unknown }) => void;
  };

  function sentOptions(mutate: ReturnType<typeof stubMutate>): CastVoteOptions {
    return mutate.mock.calls[0][0] as unknown as CastVoteOptions;
  }

  it('sends the vote, and shows it before the server answers', async () => {
    const mutate = stubMutate();
    await castVote('trip1', 'ta1', -1, 'alice@x.com');
    const sent = sentOptions(mutate);
    expect(sent.variables).toEqual({
      input: { tripId: 'trip1', tripActivityId: 'ta1', value: -1 },
    });
    expect(sent.optimisticResponse).toEqual({
      castVote: { vote: voteJson('ta1', 'alice@x.com', -1) },
    });
  });

  it('shows a cleared vote as none before the server answers', async () => {
    const mutate = stubMutate();
    await castVote('trip1', 'ta1', 0, 'alice@x.com');
    expect(sentOptions(mutate).optimisticResponse).toEqual({ castVote: { vote: null } });
  });

  it('removes the caller’s vote when the result carries no data', async () => {
    installFetch({
      TripDetail: () =>
        jsonResponse({
          data: tripJson({
            votes: [voteJson('ta1', 'alice@x.com', 1), voteJson('ta1', 'bob@x.com', 1)],
          }),
        }),
    });
    await seedTrip();
    const mutate = stubMutate();
    await castVote('trip1', 'ta1', 1, 'alice@x.com');
    sentOptions(mutate).update(apolloClient.cache, {});
    expect(readVotes()).toEqual([voteJson('ta1', 'bob@x.com', 1)]);
  });

  it('leaves the cache alone when the trip isn’t in it', async () => {
    const mutate = stubMutate();
    await castVote('trip1', 'ta1', 1, 'alice@x.com');
    expect(() =>
      sentOptions(mutate).update(apolloClient.cache, {
        data: { castVote: { vote: voteJson('ta1', 'alice@x.com', 1) } },
      }),
    ).not.toThrow();
    expect(
      apolloClient.cache.readQuery({ query: TRIP_QUERY, variables: { id: 'trip1' } }),
    ).toBeNull();
  });
});
