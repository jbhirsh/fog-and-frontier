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
    "\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location {\n        city\n        coords {\n          lat\n          lng\n        }\n      }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      coverCredit\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      costTier\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      sourceUrl\n      completed\n      completedDate\n      notes\n      contributors\n      parentId\n    }\n  }\n": typeof types.ActivitiesDocument,
    "\n  query CheckDuplicate($name: String!, $lat: Float!, $lng: Float!) {\n    checkDuplicate(name: $name, lat: $lat, lng: $lng) {\n      id\n      name\n      city\n      distanceMeters\n      confidence\n    }\n  }\n": typeof types.CheckDuplicateDocument,
    "\n  mutation FindSharedPlaces($url: String!, $hint: String) {\n    findSharedPlaces(url: $url, hint: $hint) {\n      post {\n        url\n        author\n        caption\n        imageUrl\n        isVideo\n      }\n      places {\n        name\n        city\n        lat\n        lng\n        detail\n        source\n        saved {\n          id\n          name\n          city\n          distanceMeters\n          confidence\n        }\n      }\n      read {\n        caption\n        video\n        geotag\n      }\n    }\n  }\n": typeof types.FindSharedPlacesDocument,
    "\n  mutation SuggestTripActivities($input: SuggestTripActivitiesInput!) {\n    suggestTripActivities(input: $input) {\n      suggestions {\n        activityId\n        reason\n        activity {\n          id\n          name\n          category\n          location {\n            city\n          }\n        }\n      }\n    }\n  }\n": typeof types.SuggestTripActivitiesDocument,
    "\n  query Completed {\n    completed {\n      __typename\n      id\n      completed\n    }\n  }\n": typeof types.CompletedDocument,
    "\n  query ActivityReviews {\n    activityReviews {\n      __typename\n      activityId\n      authorEmail\n      authorName\n      rating\n      note\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.ActivityReviewsDocument,
    "\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n": typeof types.TripsListDocument,
    "\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location {\n            city\n            coords {\n              lat\n              lng\n            }\n          }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          coverCredit\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          costTier\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          sourceUrl\n          completed\n          completedDate\n          notes\n          contributors\n        }\n      }\n      members {\n        email\n        displayName\n        addedByEmail\n        addedAt\n        isCreator\n      }\n      invites {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n      votes {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n": typeof types.TripDetailDocument,
    "\n  query UsersList {\n    users {\n      email\n      displayName\n    }\n  }\n": typeof types.UsersListDocument,
    "\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events {\n        name\n        dateText\n        startDate\n        endDate\n        location\n        blurb\n        sourceUrl\n      }\n      sources {\n        uri\n        title\n      }\n    }\n  }\n": typeof types.DiscoverDocument,
    "\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) {\n      activity {\n        id\n      }\n    }\n  }\n": typeof types.SaveActivityDocument,
    "\n  mutation SuggestActivity($input: SuggestActivityInput!) {\n    suggestActivity(input: $input) {\n      suggestion {\n        id\n      }\n    }\n  }\n": typeof types.SuggestActivityDocument,
    "\n  query PendingSuggestions {\n    pendingSuggestions {\n      id\n      suggestedBy\n      suggestedAt\n      activity {\n        id\n        name\n        shortDescription\n        longDescription\n        category\n        location {\n          city\n        }\n        duration\n        costTier\n        coverImage\n        allTrailsUrl\n        reservationUrl\n        menuUrl\n        notes\n      }\n    }\n  }\n": typeof types.PendingSuggestionsDocument,
    "\n  mutation AcceptSuggestion($id: ID!, $allowDuplicate: Boolean) {\n    acceptSuggestion(id: $id, allowDuplicate: $allowDuplicate) {\n      activity {\n        id\n        name\n      }\n    }\n  }\n": typeof types.AcceptSuggestionDocument,
    "\n  mutation RejectSuggestion($id: ID!) {\n    rejectSuggestion(id: $id) {\n      id\n    }\n  }\n": typeof types.RejectSuggestionDocument,
    "\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) {\n      deletedId\n    }\n  }\n": typeof types.DeleteActivityDocument,
    "\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) {\n      __typename\n      id\n      completed\n    }\n  }\n": typeof types.SetCompletedDocument,
    "\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        costTier\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        allTrailsOptions {\n          url\n          title\n          description\n          image\n          rating\n          reviews\n          miles\n          feet\n        }\n        notes\n        coverImage\n        coverCredit\n        parentId\n      }\n    }\n  }\n": typeof types.GenerateActivityDocument,
    "\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup {\n        allTrailsRating\n        hikeDistanceMiles\n        hikeElevationFeet\n      }\n    }\n  }\n": typeof types.AlltrailsLookupDocument,
    "\n  mutation SaveActivityReview($input: SaveActivityReviewInput!) {\n    saveActivityReview(input: $input) {\n      review {\n        __typename\n        activityId\n        authorEmail\n        authorName\n        rating\n        note\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.SaveActivityReviewDocument,
    "\n  mutation DeleteActivityReview($input: DeleteActivityReviewInput!) {\n    deleteActivityReview(input: $input) {\n      activityId\n      authorEmail\n    }\n  }\n": typeof types.DeleteActivityReviewDocument,
    "\n  query ActivityPhotos($activityId: ID!) {\n    activityPhotos(activityId: $activityId) {\n      __typename\n      id\n      activityId\n      url\n      createdAt\n    }\n  }\n": typeof types.ActivityPhotosDocument,
    "\n  mutation PhotoUpload($input: PhotoUploadInput!) {\n    photoUpload(input: $input) {\n      pathname\n      clientToken\n    }\n  }\n": typeof types.PhotoUploadDocument,
    "\n  mutation AddActivityPhoto($input: AddActivityPhotoInput!) {\n    addActivityPhoto(input: $input) {\n      photo {\n        __typename\n        id\n        activityId\n        url\n        createdAt\n      }\n    }\n  }\n": typeof types.AddActivityPhotoDocument,
    "\n  mutation RemoveActivityPhoto($input: RemoveActivityPhotoInput!) {\n    removeActivityPhoto(input: $input) {\n      removedId\n    }\n  }\n": typeof types.RemoveActivityPhotoDocument,
    "\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n": typeof types.CreateTripDocument,
    "\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n": typeof types.PatchTripDocument,
    "\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) {\n      deletedId\n    }\n  }\n": typeof types.DeleteTripDocument,
    "\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n": typeof types.AddTripActivityDocument,
    "\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n": typeof types.AssignSlotDocument,
    "\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n": typeof types.SetDisplayOrderDocument,
    "\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) {\n      deletedId\n    }\n  }\n": typeof types.RemoveTripActivityDocument,
    "\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n": typeof types.CastVoteDocument,
    "\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n": typeof types.TransitionTripDocument,
    "\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n    }\n  }\n": typeof types.InviteMemberDocument,
    "\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) {\n      removedEmail\n    }\n  }\n": typeof types.RemoveMemberDocument,
    "\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) {\n      revokedToken\n    }\n  }\n": typeof types.RevokeInviteDocument,
    "\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) {\n      tripId\n    }\n  }\n": typeof types.ClaimInviteDocument,
    "\n  query DrivingMiles($lat: Float!, $lng: Float!) {\n    drivingMiles(lat: $lat, lng: $lng) {\n      id\n      miles\n    }\n  }\n": typeof types.DrivingMilesDocument,
};
const documents: Documents = {
    "\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location {\n        city\n        coords {\n          lat\n          lng\n        }\n      }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      coverCredit\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      costTier\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      sourceUrl\n      completed\n      completedDate\n      notes\n      contributors\n      parentId\n    }\n  }\n": types.ActivitiesDocument,
    "\n  query CheckDuplicate($name: String!, $lat: Float!, $lng: Float!) {\n    checkDuplicate(name: $name, lat: $lat, lng: $lng) {\n      id\n      name\n      city\n      distanceMeters\n      confidence\n    }\n  }\n": types.CheckDuplicateDocument,
    "\n  mutation FindSharedPlaces($url: String!, $hint: String) {\n    findSharedPlaces(url: $url, hint: $hint) {\n      post {\n        url\n        author\n        caption\n        imageUrl\n        isVideo\n      }\n      places {\n        name\n        city\n        lat\n        lng\n        detail\n        source\n        saved {\n          id\n          name\n          city\n          distanceMeters\n          confidence\n        }\n      }\n      read {\n        caption\n        video\n        geotag\n      }\n    }\n  }\n": types.FindSharedPlacesDocument,
    "\n  mutation SuggestTripActivities($input: SuggestTripActivitiesInput!) {\n    suggestTripActivities(input: $input) {\n      suggestions {\n        activityId\n        reason\n        activity {\n          id\n          name\n          category\n          location {\n            city\n          }\n        }\n      }\n    }\n  }\n": types.SuggestTripActivitiesDocument,
    "\n  query Completed {\n    completed {\n      __typename\n      id\n      completed\n    }\n  }\n": types.CompletedDocument,
    "\n  query ActivityReviews {\n    activityReviews {\n      __typename\n      activityId\n      authorEmail\n      authorName\n      rating\n      note\n      createdAt\n      updatedAt\n    }\n  }\n": types.ActivityReviewsDocument,
    "\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n": types.TripsListDocument,
    "\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location {\n            city\n            coords {\n              lat\n              lng\n            }\n          }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          coverCredit\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          costTier\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          sourceUrl\n          completed\n          completedDate\n          notes\n          contributors\n        }\n      }\n      members {\n        email\n        displayName\n        addedByEmail\n        addedAt\n        isCreator\n      }\n      invites {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n      votes {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n": types.TripDetailDocument,
    "\n  query UsersList {\n    users {\n      email\n      displayName\n    }\n  }\n": types.UsersListDocument,
    "\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events {\n        name\n        dateText\n        startDate\n        endDate\n        location\n        blurb\n        sourceUrl\n      }\n      sources {\n        uri\n        title\n      }\n    }\n  }\n": types.DiscoverDocument,
    "\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) {\n      activity {\n        id\n      }\n    }\n  }\n": types.SaveActivityDocument,
    "\n  mutation SuggestActivity($input: SuggestActivityInput!) {\n    suggestActivity(input: $input) {\n      suggestion {\n        id\n      }\n    }\n  }\n": types.SuggestActivityDocument,
    "\n  query PendingSuggestions {\n    pendingSuggestions {\n      id\n      suggestedBy\n      suggestedAt\n      activity {\n        id\n        name\n        shortDescription\n        longDescription\n        category\n        location {\n          city\n        }\n        duration\n        costTier\n        coverImage\n        allTrailsUrl\n        reservationUrl\n        menuUrl\n        notes\n      }\n    }\n  }\n": types.PendingSuggestionsDocument,
    "\n  mutation AcceptSuggestion($id: ID!, $allowDuplicate: Boolean) {\n    acceptSuggestion(id: $id, allowDuplicate: $allowDuplicate) {\n      activity {\n        id\n        name\n      }\n    }\n  }\n": types.AcceptSuggestionDocument,
    "\n  mutation RejectSuggestion($id: ID!) {\n    rejectSuggestion(id: $id) {\n      id\n    }\n  }\n": types.RejectSuggestionDocument,
    "\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) {\n      deletedId\n    }\n  }\n": types.DeleteActivityDocument,
    "\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) {\n      __typename\n      id\n      completed\n    }\n  }\n": types.SetCompletedDocument,
    "\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        costTier\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        allTrailsOptions {\n          url\n          title\n          description\n          image\n          rating\n          reviews\n          miles\n          feet\n        }\n        notes\n        coverImage\n        coverCredit\n        parentId\n      }\n    }\n  }\n": types.GenerateActivityDocument,
    "\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup {\n        allTrailsRating\n        hikeDistanceMiles\n        hikeElevationFeet\n      }\n    }\n  }\n": types.AlltrailsLookupDocument,
    "\n  mutation SaveActivityReview($input: SaveActivityReviewInput!) {\n    saveActivityReview(input: $input) {\n      review {\n        __typename\n        activityId\n        authorEmail\n        authorName\n        rating\n        note\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.SaveActivityReviewDocument,
    "\n  mutation DeleteActivityReview($input: DeleteActivityReviewInput!) {\n    deleteActivityReview(input: $input) {\n      activityId\n      authorEmail\n    }\n  }\n": types.DeleteActivityReviewDocument,
    "\n  query ActivityPhotos($activityId: ID!) {\n    activityPhotos(activityId: $activityId) {\n      __typename\n      id\n      activityId\n      url\n      createdAt\n    }\n  }\n": types.ActivityPhotosDocument,
    "\n  mutation PhotoUpload($input: PhotoUploadInput!) {\n    photoUpload(input: $input) {\n      pathname\n      clientToken\n    }\n  }\n": types.PhotoUploadDocument,
    "\n  mutation AddActivityPhoto($input: AddActivityPhotoInput!) {\n    addActivityPhoto(input: $input) {\n      photo {\n        __typename\n        id\n        activityId\n        url\n        createdAt\n      }\n    }\n  }\n": types.AddActivityPhotoDocument,
    "\n  mutation RemoveActivityPhoto($input: RemoveActivityPhotoInput!) {\n    removeActivityPhoto(input: $input) {\n      removedId\n    }\n  }\n": types.RemoveActivityPhotoDocument,
    "\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n": types.CreateTripDocument,
    "\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n": types.PatchTripDocument,
    "\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) {\n      deletedId\n    }\n  }\n": types.DeleteTripDocument,
    "\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n": types.AddTripActivityDocument,
    "\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n": types.AssignSlotDocument,
    "\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n": types.SetDisplayOrderDocument,
    "\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) {\n      deletedId\n    }\n  }\n": types.RemoveTripActivityDocument,
    "\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n": types.CastVoteDocument,
    "\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n": types.TransitionTripDocument,
    "\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n    }\n  }\n": types.InviteMemberDocument,
    "\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) {\n      removedEmail\n    }\n  }\n": types.RemoveMemberDocument,
    "\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) {\n      revokedToken\n    }\n  }\n": types.RevokeInviteDocument,
    "\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) {\n      tripId\n    }\n  }\n": types.ClaimInviteDocument,
    "\n  query DrivingMiles($lat: Float!, $lng: Float!) {\n    drivingMiles(lat: $lat, lng: $lng) {\n      id\n      miles\n    }\n  }\n": types.DrivingMilesDocument,
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
export function graphql(source: "\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location {\n        city\n        coords {\n          lat\n          lng\n        }\n      }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      coverCredit\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      costTier\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      sourceUrl\n      completed\n      completedDate\n      notes\n      contributors\n      parentId\n    }\n  }\n"): (typeof documents)["\n  query Activities {\n    activities {\n      id\n      name\n      shortDescription\n      longDescription\n      category\n      region\n      parkType\n      location {\n        city\n        coords {\n          lat\n          lng\n        }\n      }\n      duration\n      durationDetail\n      difficulty\n      dogFriendly\n      coverImage\n      coverCredit\n      galleryImages\n      allTrailsUrl\n      allTrailsRating\n      hikeDistanceMiles\n      hikeElevationFeet\n      cuisine\n      priceRange\n      costTier\n      hours\n      reservationUrl\n      menuUrl\n      dietary\n      sourceUrl\n      completed\n      completedDate\n      notes\n      contributors\n      parentId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CheckDuplicate($name: String!, $lat: Float!, $lng: Float!) {\n    checkDuplicate(name: $name, lat: $lat, lng: $lng) {\n      id\n      name\n      city\n      distanceMeters\n      confidence\n    }\n  }\n"): (typeof documents)["\n  query CheckDuplicate($name: String!, $lat: Float!, $lng: Float!) {\n    checkDuplicate(name: $name, lat: $lat, lng: $lng) {\n      id\n      name\n      city\n      distanceMeters\n      confidence\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation FindSharedPlaces($url: String!, $hint: String) {\n    findSharedPlaces(url: $url, hint: $hint) {\n      post {\n        url\n        author\n        caption\n        imageUrl\n        isVideo\n      }\n      places {\n        name\n        city\n        lat\n        lng\n        detail\n        source\n        saved {\n          id\n          name\n          city\n          distanceMeters\n          confidence\n        }\n      }\n      read {\n        caption\n        video\n        geotag\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation FindSharedPlaces($url: String!, $hint: String) {\n    findSharedPlaces(url: $url, hint: $hint) {\n      post {\n        url\n        author\n        caption\n        imageUrl\n        isVideo\n      }\n      places {\n        name\n        city\n        lat\n        lng\n        detail\n        source\n        saved {\n          id\n          name\n          city\n          distanceMeters\n          confidence\n        }\n      }\n      read {\n        caption\n        video\n        geotag\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SuggestTripActivities($input: SuggestTripActivitiesInput!) {\n    suggestTripActivities(input: $input) {\n      suggestions {\n        activityId\n        reason\n        activity {\n          id\n          name\n          category\n          location {\n            city\n          }\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SuggestTripActivities($input: SuggestTripActivitiesInput!) {\n    suggestTripActivities(input: $input) {\n      suggestions {\n        activityId\n        reason\n        activity {\n          id\n          name\n          category\n          location {\n            city\n          }\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Completed {\n    completed {\n      __typename\n      id\n      completed\n    }\n  }\n"): (typeof documents)["\n  query Completed {\n    completed {\n      __typename\n      id\n      completed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ActivityReviews {\n    activityReviews {\n      __typename\n      activityId\n      authorEmail\n      authorName\n      rating\n      note\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query ActivityReviews {\n    activityReviews {\n      __typename\n      activityId\n      authorEmail\n      authorName\n      rating\n      note\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n"): (typeof documents)["\n  query TripsList {\n    trips {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      scheduledCount\n      unscheduledCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location {\n            city\n            coords {\n              lat\n              lng\n            }\n          }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          coverCredit\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          costTier\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          sourceUrl\n          completed\n          completedDate\n          notes\n          contributors\n        }\n      }\n      members {\n        email\n        displayName\n        addedByEmail\n        addedAt\n        isCreator\n      }\n      invites {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n      votes {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n"): (typeof documents)["\n  query TripDetail($id: ID!) {\n    trip(id: $id) {\n      id\n      creatorEmail\n      title\n      description\n      startDate\n      endDate\n      coverImageUrl\n      status\n      createdAt\n      markedPastAt\n      activities {\n        id\n        tripId\n        activityId\n        addedByEmail\n        addedAt\n        dayIndex\n        startTime\n        displayOrder\n        snapshot {\n          id\n          name\n          shortDescription\n          longDescription\n          category\n          region\n          parkType\n          location {\n            city\n            coords {\n              lat\n              lng\n            }\n          }\n          duration\n          durationDetail\n          difficulty\n          dogFriendly\n          coverImage\n          coverCredit\n          galleryImages\n          allTrailsUrl\n          allTrailsRating\n          hikeDistanceMiles\n          hikeElevationFeet\n          cuisine\n          priceRange\n          costTier\n          hours\n          reservationUrl\n          menuUrl\n          dietary\n          sourceUrl\n          completed\n          completedDate\n          notes\n          contributors\n        }\n      }\n      members {\n        email\n        displayName\n        addedByEmail\n        addedAt\n        isCreator\n      }\n      invites {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n      votes {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query UsersList {\n    users {\n      email\n      displayName\n    }\n  }\n"): (typeof documents)["\n  query UsersList {\n    users {\n      email\n      displayName\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events {\n        name\n        dateText\n        startDate\n        endDate\n        location\n        blurb\n        sourceUrl\n      }\n      sources {\n        uri\n        title\n      }\n    }\n  }\n"): (typeof documents)["\n  query Discover($range: DiscoverRange) {\n    discover(range: $range) {\n      range\n      events {\n        name\n        dateText\n        startDate\n        endDate\n        location\n        blurb\n        sourceUrl\n      }\n      sources {\n        uri\n        title\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) {\n      activity {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SaveActivity($input: SaveActivityInput!) {\n    saveActivity(input: $input) {\n      activity {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SuggestActivity($input: SuggestActivityInput!) {\n    suggestActivity(input: $input) {\n      suggestion {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SuggestActivity($input: SuggestActivityInput!) {\n    suggestActivity(input: $input) {\n      suggestion {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PendingSuggestions {\n    pendingSuggestions {\n      id\n      suggestedBy\n      suggestedAt\n      activity {\n        id\n        name\n        shortDescription\n        longDescription\n        category\n        location {\n          city\n        }\n        duration\n        costTier\n        coverImage\n        allTrailsUrl\n        reservationUrl\n        menuUrl\n        notes\n      }\n    }\n  }\n"): (typeof documents)["\n  query PendingSuggestions {\n    pendingSuggestions {\n      id\n      suggestedBy\n      suggestedAt\n      activity {\n        id\n        name\n        shortDescription\n        longDescription\n        category\n        location {\n          city\n        }\n        duration\n        costTier\n        coverImage\n        allTrailsUrl\n        reservationUrl\n        menuUrl\n        notes\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AcceptSuggestion($id: ID!, $allowDuplicate: Boolean) {\n    acceptSuggestion(id: $id, allowDuplicate: $allowDuplicate) {\n      activity {\n        id\n        name\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AcceptSuggestion($id: ID!, $allowDuplicate: Boolean) {\n    acceptSuggestion(id: $id, allowDuplicate: $allowDuplicate) {\n      activity {\n        id\n        name\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RejectSuggestion($id: ID!) {\n    rejectSuggestion(id: $id) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RejectSuggestion($id: ID!) {\n    rejectSuggestion(id: $id) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) {\n      deletedId\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteActivity($input: DeleteActivityInput!) {\n    deleteActivity(input: $input) {\n      deletedId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) {\n      __typename\n      id\n      completed\n    }\n  }\n"): (typeof documents)["\n  mutation SetCompleted($input: SetCompletedInput!) {\n    setCompleted(input: $input) {\n      __typename\n      id\n      completed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        costTier\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        allTrailsOptions {\n          url\n          title\n          description\n          image\n          rating\n          reviews\n          miles\n          feet\n        }\n        notes\n        coverImage\n        coverCredit\n        parentId\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation GenerateActivity($input: GenerateActivityInput!) {\n    generateActivity(input: $input) {\n      activity {\n        name\n        shortDescription\n        longDescription\n        category\n        region\n        parkType\n        city\n        lat\n        lng\n        duration\n        durationDetail\n        difficulty\n        dogFriendly\n        hikeDistanceMiles\n        hikeElevationFeet\n        cuisine\n        priceRange\n        costTier\n        hours\n        reservationUrl\n        menuUrl\n        dietary\n        allTrailsUrl\n        allTrailsOptions {\n          url\n          title\n          description\n          image\n          rating\n          reviews\n          miles\n          feet\n        }\n        notes\n        coverImage\n        coverCredit\n        parentId\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup {\n        allTrailsRating\n        hikeDistanceMiles\n        hikeElevationFeet\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AlltrailsLookup($input: AlltrailsLookupInput!) {\n    alltrailsLookup(input: $input) {\n      lookup {\n        allTrailsRating\n        hikeDistanceMiles\n        hikeElevationFeet\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveActivityReview($input: SaveActivityReviewInput!) {\n    saveActivityReview(input: $input) {\n      review {\n        __typename\n        activityId\n        authorEmail\n        authorName\n        rating\n        note\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SaveActivityReview($input: SaveActivityReviewInput!) {\n    saveActivityReview(input: $input) {\n      review {\n        __typename\n        activityId\n        authorEmail\n        authorName\n        rating\n        note\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteActivityReview($input: DeleteActivityReviewInput!) {\n    deleteActivityReview(input: $input) {\n      activityId\n      authorEmail\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteActivityReview($input: DeleteActivityReviewInput!) {\n    deleteActivityReview(input: $input) {\n      activityId\n      authorEmail\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ActivityPhotos($activityId: ID!) {\n    activityPhotos(activityId: $activityId) {\n      __typename\n      id\n      activityId\n      url\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query ActivityPhotos($activityId: ID!) {\n    activityPhotos(activityId: $activityId) {\n      __typename\n      id\n      activityId\n      url\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PhotoUpload($input: PhotoUploadInput!) {\n    photoUpload(input: $input) {\n      pathname\n      clientToken\n    }\n  }\n"): (typeof documents)["\n  mutation PhotoUpload($input: PhotoUploadInput!) {\n    photoUpload(input: $input) {\n      pathname\n      clientToken\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddActivityPhoto($input: AddActivityPhotoInput!) {\n    addActivityPhoto(input: $input) {\n      photo {\n        __typename\n        id\n        activityId\n        url\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AddActivityPhoto($input: AddActivityPhotoInput!) {\n    addActivityPhoto(input: $input) {\n      photo {\n        __typename\n        id\n        activityId\n        url\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveActivityPhoto($input: RemoveActivityPhotoInput!) {\n    removeActivityPhoto(input: $input) {\n      removedId\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveActivityPhoto($input: RemoveActivityPhotoInput!) {\n    removeActivityPhoto(input: $input) {\n      removedId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation CreateTrip($input: CreateTripInput!) {\n    createTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation PatchTrip($input: PatchTripInput!) {\n    patchTrip(input: $input) {\n      trip {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) {\n      deletedId\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteTrip($input: DeleteTripInput!) {\n    deleteTrip(input: $input) {\n      deletedId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AddTripActivity($input: AddTripActivityInput!) {\n    addTripActivity(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AssignSlot($input: AssignSlotInput!) {\n    assignSlot(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SetDisplayOrder($input: SetDisplayOrderInput!) {\n    setDisplayOrder(input: $input) {\n      tripActivity {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) {\n      deletedId\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveTripActivity($input: RemoveTripActivityInput!) {\n    removeTripActivity(input: $input) {\n      deletedId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation CastVote($input: CastVoteInput!) {\n    castVote(input: $input) {\n      vote {\n        __typename\n        tripActivityId\n        memberEmail\n        value\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n"): (typeof documents)["\n  mutation TransitionTrip($input: TransitionTripInput!) {\n    transitionTrip(input: $input) {\n      ok\n      status\n      kept\n      markedPastAt\n      completedActivityIds\n      uncompletedActivityIds\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation InviteMember($input: InviteMemberInput!) {\n    inviteMember(input: $input) {\n      invite {\n        inviteToken\n        invitedEmail\n        invitedByEmail\n        invitedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) {\n      removedEmail\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveMember($input: RemoveMemberInput!) {\n    removeMember(input: $input) {\n      removedEmail\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) {\n      revokedToken\n    }\n  }\n"): (typeof documents)["\n  mutation RevokeInvite($input: RevokeInviteInput!) {\n    revokeInvite(input: $input) {\n      revokedToken\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) {\n      tripId\n    }\n  }\n"): (typeof documents)["\n  mutation ClaimInvite($input: ClaimInviteInput!) {\n    claimInvite(input: $input) {\n      tripId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DrivingMiles($lat: Float!, $lng: Float!) {\n    drivingMiles(lat: $lat, lng: $lng) {\n      id\n      miles\n    }\n  }\n"): (typeof documents)["\n  query DrivingMiles($lat: Float!, $lng: Float!) {\n    drivingMiles(lat: $lat, lng: $lng) {\n      id\n      miles\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;