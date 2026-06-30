// Centralized typed GraphQL documents (issue #91).
//
// NOTE: selections are written INLINE rather than via shared fragments. This
// originally dodged a graphql-codegen client-preset crash on fragment *spreads*
// under graphql@17 ("spread.directives is not iterable"); the repo is now on
// graphql ^16 (codegen-supported) and inline selections are kept for simplicity.
// Cache consistency is kept by (a) selecting the full field set on the two
// canonical reads (ACTIVITIES, TRIP) and (b) refetching TRIP after trip
// mutations, so mutation payloads stay minimal.
import { graphql, type DocumentType } from '../gql';

// ---- canonical reads (full field sets) ----

export const ACTIVITIES_QUERY = graphql(`
  query Activities {
    activities {
      id
      name
      shortDescription
      longDescription
      category
      region
      parkType
      location { city coords { lat lng } }
      duration
      durationDetail
      difficulty
      dogFriendly
      coverImage
      galleryImages
      allTrailsUrl
      allTrailsRating
      hikeDistanceMiles
      hikeElevationFeet
      cuisine
      priceRange
      hours
      reservationUrl
      menuUrl
      dietary
      completed
      completedDate
      notes
    }
  }
`);

export const COMPLETED_QUERY = graphql(`
  query Completed {
    completed { __typename id completed }
  }
`);

export const TRIPS_QUERY = graphql(`
  query TripsList {
    trips {
      id
      creatorEmail
      title
      description
      startDate
      endDate
      coverImageUrl
      status
      createdAt
      markedPastAt
      scheduledCount
      unscheduledCount
    }
  }
`);

export const TRIP_QUERY = graphql(`
  query TripDetail($id: ID!) {
    trip(id: $id) {
      id
      creatorEmail
      title
      description
      startDate
      endDate
      coverImageUrl
      status
      createdAt
      markedPastAt
      activities {
        id
        tripId
        activityId
        addedByEmail
        addedAt
        dayIndex
        startTime
        displayOrder
        snapshot {
          id
          name
          shortDescription
          longDescription
          category
          region
          parkType
          location { city coords { lat lng } }
          duration
          durationDetail
          difficulty
          dogFriendly
          coverImage
          galleryImages
          allTrailsUrl
          allTrailsRating
          hikeDistanceMiles
          hikeElevationFeet
          cuisine
          priceRange
          hours
          reservationUrl
          menuUrl
          dietary
          completed
          completedDate
          notes
        }
      }
      members { email displayName addedByEmail addedAt isCreator }
      invites { inviteToken invitedEmail invitedByEmail invitedAt }
      votes { __typename tripActivityId memberEmail value }
    }
  }
`);

export const USERS_QUERY = graphql(`
  query UsersList {
    users { email displayName }
  }
`);

export const DISCOVER_QUERY = graphql(`
  query Discover($range: DiscoverRange) {
    discover(range: $range) {
      range
      events { name dateText startDate endDate location blurb sourceUrl }
      sources { uri title }
    }
  }
`);

// ---- mutations (minimal payloads; trip writes refetch TRIP) ----

export const SAVE_ACTIVITY = graphql(`
  mutation SaveActivity($input: SaveActivityInput!) {
    saveActivity(input: $input) { activity { id } }
  }
`);

export const DELETE_ACTIVITY = graphql(`
  mutation DeleteActivity($input: DeleteActivityInput!) {
    deleteActivity(input: $input) { deletedId }
  }
`);

export const SET_COMPLETED = graphql(`
  mutation SetCompleted($input: SetCompletedInput!) {
    setCompleted(input: $input) { __typename id completed }
  }
`);

export const GENERATE_ACTIVITY = graphql(`
  mutation GenerateActivity($input: GenerateActivityInput!) {
    generateActivity(input: $input) {
      activity {
        name
        shortDescription
        longDescription
        category
        region
        parkType
        city
        lat
        lng
        duration
        durationDetail
        difficulty
        dogFriendly
        hikeDistanceMiles
        hikeElevationFeet
        cuisine
        priceRange
        hours
        reservationUrl
        menuUrl
        dietary
        allTrailsUrl
        notes
        coverImage
      }
    }
  }
`);

export const ALLTRAILS_LOOKUP = graphql(`
  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {
    alltrailsLookup(input: $input) {
      lookup { allTrailsRating hikeDistanceMiles hikeElevationFeet }
    }
  }
`);

export const CREATE_TRIP = graphql(`
  mutation CreateTrip($input: CreateTripInput!) {
    createTrip(input: $input) { trip { id } }
  }
`);

export const PATCH_TRIP = graphql(`
  mutation PatchTrip($input: PatchTripInput!) {
    patchTrip(input: $input) { trip { id } }
  }
`);

export const DELETE_TRIP = graphql(`
  mutation DeleteTrip($input: DeleteTripInput!) {
    deleteTrip(input: $input) { deletedId }
  }
`);

export const ADD_TRIP_ACTIVITY = graphql(`
  mutation AddTripActivity($input: AddTripActivityInput!) {
    addTripActivity(input: $input) { tripActivity { id } }
  }
`);

export const ASSIGN_SLOT = graphql(`
  mutation AssignSlot($input: AssignSlotInput!) {
    assignSlot(input: $input) { tripActivity { id } }
  }
`);

export const SET_DISPLAY_ORDER = graphql(`
  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {
    setDisplayOrder(input: $input) { tripActivity { id } }
  }
`);

export const REMOVE_TRIP_ACTIVITY = graphql(`
  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {
    removeTripActivity(input: $input) { deletedId }
  }
`);

export const CAST_VOTE = graphql(`
  mutation CastVote($input: CastVoteInput!) {
    castVote(input: $input) {
      vote { __typename tripActivityId memberEmail value }
    }
  }
`);

export const TRANSITION_TRIP = graphql(`
  mutation TransitionTrip($input: TransitionTripInput!) {
    transitionTrip(input: $input) {
      ok
      status
      kept
      markedPastAt
      completedActivityIds
      uncompletedActivityIds
    }
  }
`);

export const INVITE_MEMBER = graphql(`
  mutation InviteMember($input: InviteMemberInput!) {
    inviteMember(input: $input) {
      invite { inviteToken invitedEmail invitedByEmail invitedAt }
    }
  }
`);

export const REMOVE_MEMBER = graphql(`
  mutation RemoveMember($input: RemoveMemberInput!) {
    removeMember(input: $input) { removedEmail }
  }
`);

export const REVOKE_INVITE = graphql(`
  mutation RevokeInvite($input: RevokeInviteInput!) {
    revokeInvite(input: $input) { revokedToken }
  }
`);

export const CLAIM_INVITE = graphql(`
  mutation ClaimInvite($input: ClaimInviteInput!) {
    claimInvite(input: $input) { tripId }
  }
`);

// ---- derived row types (for boundary mappers) ----
export type ActivitiesData = DocumentType<typeof ACTIVITIES_QUERY>;
export type ActivityRow = ActivitiesData['activities'][number];

export type TripData = DocumentType<typeof TRIP_QUERY>;
export type TripRow = NonNullable<TripData['trip']>;
export type TripActivityRow = TripRow['activities'][number];
// All-nullable snapshot shape; an Activity row (non-null fields, different
// __typename) is structurally assignable to this, so one mapper covers both.
export type SnapshotRow = NonNullable<TripActivityRow['snapshot']>;
export type ActivityLike = Omit<SnapshotRow, '__typename'>;

export type TripListData = DocumentType<typeof TRIPS_QUERY>;
export type TripListRow = TripListData['trips'][number];

export type GeneratedActivityRow = DocumentType<
  typeof GENERATE_ACTIVITY
>['generateActivity']['activity'];
