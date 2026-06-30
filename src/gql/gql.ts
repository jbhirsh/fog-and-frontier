/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location { city coords { lat lng } }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      completed\n      completedDate\n      notes\n    }\n  }\n": typeof types.ActivitiesDocument,
    "\n  query Completed {\n    completed { __typename id completed }\n  }\n": typeof types.CompletedDocument,
    "\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n": typeof types.TripsListDocument,
    "\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location { city coords { lat lng } }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          completed\n          completedDate\n          notes\n        }\n      }\n      members { email displayName addedByEmail addedAt isCreator }\n      invites { inviteToken invitedEmail invitedByEmail invitedAt }\n      votes { __typename tripActivityId memberEmail value }\n    }\n  }\n": typeof types.TripDetailDocument,
    "\n  query UsersList {\n    users { email displayName }\n  }\n": typeof types.UsersListDocument,
    "\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events { name dateText startDate endDate location blurb sourceUrl }\n      sources { uri title }\n    }\n  }\n": typeof types.DiscoverDocument,
    "\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) { activity { id } }\n  }\n": typeof types.SaveActivityDocument,
    "\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) { deletedId }\n  }\n": typeof types.DeleteActivityDocument,
    "\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) { __typename id completed }\n  }\n": typeof types.SetCompletedDocument,
    "\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        notes\n        coverImage\n      }\n    }\n  }\n": typeof types.GenerateActivityDocument,
    "\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup { allTrailsRating hikeDistanceMiles hikeElevationFeet }\n    }\n  }\n": typeof types.AlltrailsLookupDocument,
    "\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) { trip { id } }\n  }\n": typeof types.CreateTripDocument,
    "\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) { trip { id } }\n  }\n": typeof types.PatchTripDocument,
    "\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) { deletedId }\n  }\n": typeof types.DeleteTripDocument,
    "\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) { tripActivity { id } }\n  }\n": typeof types.AddTripActivityDocument,
    "\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) { tripActivity { id } }\n  }\n": typeof types.AssignSlotDocument,
    "\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) { tripActivity { id } }\n  }\n": typeof types.SetDisplayOrderDocument,
    "\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) { deletedId }\n  }\n": typeof types.RemoveTripActivityDocument,
    "\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote { __typename tripActivityId memberEmail value }\n    }\n  }\n": typeof types.CastVoteDocument,
    "\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n": typeof types.TransitionTripDocument,
    "\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite { inviteToken invitedEmail invitedByEmail invitedAt }\n    }\n  }\n": typeof types.InviteMemberDocument,
    "\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) { removedEmail }\n  }\n": typeof types.RemoveMemberDocument,
    "\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) { revokedToken }\n  }\n": typeof types.RevokeInviteDocument,
    "\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) { tripId }\n  }\n": typeof types.ClaimInviteDocument,
};
const documents: Documents = {
    "\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location { city coords { lat lng } }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      completed\n      completedDate\n      notes\n    }\n  }\n": types.ActivitiesDocument,
    "\n  query Completed {\n    completed { __typename id completed }\n  }\n": types.CompletedDocument,
    "\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n": types.TripsListDocument,
    "\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location { city coords { lat lng } }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          completed\n          completedDate\n          notes\n        }\n      }\n      members { email displayName addedByEmail addedAt isCreator }\n      invites { inviteToken invitedEmail invitedByEmail invitedAt }\n      votes { __typename tripActivityId memberEmail value }\n    }\n  }\n": types.TripDetailDocument,
    "\n  query UsersList {\n    users { email displayName }\n  }\n": types.UsersListDocument,
    "\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events { name dateText startDate endDate location blurb sourceUrl }\n      sources { uri title }\n    }\n  }\n": types.DiscoverDocument,
    "\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) { activity { id } }\n  }\n": types.SaveActivityDocument,
    "\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) { deletedId }\n  }\n": types.DeleteActivityDocument,
    "\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) { __typename id completed }\n  }\n": types.SetCompletedDocument,
    "\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        notes\n        coverImage\n      }\n    }\n  }\n": types.GenerateActivityDocument,
    "\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup { allTrailsRating hikeDistanceMiles hikeElevationFeet }\n    }\n  }\n": types.AlltrailsLookupDocument,
    "\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) { trip { id } }\n  }\n": types.CreateTripDocument,
    "\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) { trip { id } }\n  }\n": types.PatchTripDocument,
    "\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) { deletedId }\n  }\n": types.DeleteTripDocument,
    "\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) { tripActivity { id } }\n  }\n": types.AddTripActivityDocument,
    "\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) { tripActivity { id } }\n  }\n": types.AssignSlotDocument,
    "\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) { tripActivity { id } }\n  }\n": types.SetDisplayOrderDocument,
    "\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) { deletedId }\n  }\n": types.RemoveTripActivityDocument,
    "\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote { __typename tripActivityId memberEmail value }\n    }\n  }\n": types.CastVoteDocument,
    "\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n": types.TransitionTripDocument,
    "\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite { inviteToken invitedEmail invitedByEmail invitedAt }\n    }\n  }\n": types.InviteMemberDocument,
    "\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) { removedEmail }\n  }\n": types.RemoveMemberDocument,
    "\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) { revokedToken }\n  }\n": types.RevokeInviteDocument,
    "\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) { tripId }\n  }\n": types.ClaimInviteDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location { city coords { lat lng } }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      completed\n      completedDate\n      notes\n    }\n  }\n"): (typeof documents)["\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location { city coords { lat lng } }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      completed\n      completedDate\n      notes\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Completed {\n    completed { __typename id completed }\n  }\n"): (typeof documents)["\n  query Completed {\n    completed { __typename id completed }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n"): (typeof documents)["\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location { city coords { lat lng } }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          completed\n          completedDate\n          notes\n        }\n      }\n      members { email displayName addedByEmail addedAt isCreator }\n      invites { inviteToken invitedEmail invitedByEmail invitedAt }\n      votes { __typename tripActivityId memberEmail value }\n    }\n  }\n"): (typeof documents)["\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location { city coords { lat lng } }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          completed\n          completedDate\n          notes\n        }\n      }\n      members { email displayName addedByEmail addedAt isCreator }\n      invites { inviteToken invitedEmail invitedByEmail invitedAt }\n      votes { __typename tripActivityId memberEmail value }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query UsersList {\n    users { email displayName }\n  }\n"): (typeof documents)["\n  query UsersList {\n    users { email displayName }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events { name dateText startDate endDate location blurb sourceUrl }\n      sources { uri title }\n    }\n  }\n"): (typeof documents)["\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events { name dateText startDate endDate location blurb sourceUrl }\n      sources { uri title }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) { activity { id } }\n  }\n"): (typeof documents)["\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) { activity { id } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) { deletedId }\n  }\n"): (typeof documents)["\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) { deletedId }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) { __typename id completed }\n  }\n"): (typeof documents)["\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) { __typename id completed }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        notes\n        coverImage\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        notes\n        coverImage\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup { allTrailsRating hikeDistanceMiles hikeElevationFeet }\n    }\n  }\n"): (typeof documents)["\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup { allTrailsRating hikeDistanceMiles hikeElevationFeet }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) { trip { id } }\n  }\n"): (typeof documents)["\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) { trip { id } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) { trip { id } }\n  }\n"): (typeof documents)["\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) { trip { id } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) { deletedId }\n  }\n"): (typeof documents)["\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) { deletedId }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) { tripActivity { id } }\n  }\n"): (typeof documents)["\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) { tripActivity { id } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) { tripActivity { id } }\n  }\n"): (typeof documents)["\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) { tripActivity { id } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) { tripActivity { id } }\n  }\n"): (typeof documents)["\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) { tripActivity { id } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) { deletedId }\n  }\n"): (typeof documents)["\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) { deletedId }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote { __typename tripActivityId memberEmail value }\n    }\n  }\n"): (typeof documents)["\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote { __typename tripActivityId memberEmail value }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n"): (typeof documents)["\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite { inviteToken invitedEmail invitedByEmail invitedAt }\n    }\n  }\n"): (typeof documents)["\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite { inviteToken invitedEmail invitedByEmail invitedAt }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) { removedEmail }\n  }\n"): (typeof documents)["\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) { removedEmail }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) { revokedToken }\n  }\n"): (typeof documents)["\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) { revokedToken }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) { tripId }\n  }\n"): (typeof documents)["\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) { tripId }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;