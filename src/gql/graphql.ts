/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ActivityInput = {
  allTrailsRating?: number | null | undefined;
  allTrailsUrl?: string | null | undefined;
  category: Category;
  completed?: boolean | null | undefined;
  completedDate?: string | null | undefined;
  coverImage: string;
  cuisine?: string | null | undefined;
  dietary?: Array<string> | null | undefined;
  difficulty?: Difficulty | null | undefined;
  dogFriendly?: boolean | null | undefined;
  duration: string;
  durationDetail?: string | null | undefined;
  galleryImages?: Array<string> | null | undefined;
  hikeDistanceMiles?: number | null | undefined;
  hikeElevationFeet?: number | null | undefined;
  hours?: string | null | undefined;
  location: LocationInput;
  longDescription?: string | null | undefined;
  menuUrl?: string | null | undefined;
  name: string;
  notes?: string | null | undefined;
  parkType?: ParkType | null | undefined;
  priceRange?: string | null | undefined;
  region: string;
  reservationUrl?: string | null | undefined;
  shortDescription: string;
};

export type AddTripActivityInput = {
  activityId: string | number;
  tripId: string | number;
};

export type AlltrailsLookupInput = {
  url: string;
};

export type AssignSlotInput = {
  dayIndex?: number | null | undefined;
  displayOrder?: number | null | undefined;
  startTime?: string | null | undefined;
  taId: string | number;
};

export type CastVoteInput = {
  tripActivityId: string | number;
  tripId: string | number;
  value: number;
};

export type Category =
  | 'camping'
  | 'climbing'
  | 'culture'
  | 'cycling'
  | 'food'
  | 'hiking'
  | 'other'
  | 'scenic'
  | 'water';

export type ClaimInviteInput = {
  inviteToken: string;
};

export type CoordsInput = {
  lat: number;
  lng: number;
};

export type CreateTripInput = {
  coverImageUrl?: string | null | undefined;
  description?: string | null | undefined;
  endDate: string;
  initialActivityIds?: Array<string | number> | null | undefined;
  startDate: string;
  status?: TripStatus | null | undefined;
  title: string;
};

export type DeleteActivityInput = {
  id: string | number;
};

export type DeleteTripInput = {
  id: string | number;
};

export type Difficulty =
  | 'advanced'
  | 'easy'
  | 'moderate';

export type DiscoverRange =
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'weekend';

export type GenerateActivityInput = {
  notes?: string | null | undefined;
  title: string;
};

export type InviteMemberInput = {
  email: string;
  tripId: string | number;
};

export type LocationInput = {
  city: string;
  coords: CoordsInput;
};

export type ParkType =
  | 'city'
  | 'county'
  | 'national'
  | 'none'
  | 'private'
  | 'regional'
  | 'state';

export type PatchTripFieldsInput = {
  coverImageUrl?: string | null | undefined;
  description?: string | null | undefined;
  endDate?: string | null | undefined;
  startDate?: string | null | undefined;
  title?: string | null | undefined;
};

export type PatchTripInput = {
  id: string | number;
  patch: PatchTripFieldsInput;
};

export type RemoveMemberInput = {
  email: string;
  tripId: string | number;
};

export type RemoveTripActivityInput = {
  taId: string | number;
};

export type RevokeInviteInput = {
  token: string;
  tripId: string | number;
};

export type SaveActivityInput = {
  activity: ActivityInput;
  id: string | number;
};

export type SetCompletedInput = {
  id: string | number;
  value?: boolean | null | undefined;
};

export type SetDisplayOrderInput = {
  displayOrder: number;
  taId: string | number;
};

export type TransitionTripInput = {
  completedActivityIds?: Array<string | number> | null | undefined;
  id: string | number;
  keptActivityIds?: Array<string | number> | null | undefined;
  to: TripStatus;
};

export type TripStatus =
  | 'past'
  | 'planning'
  | 'voting';

export type ActivitiesQueryVariables = Exact<{ [key: string]: never; }>;


export type ActivitiesQuery = { activities: Array<{ id: string, name: string, shortDescription: string, longDescription: string | null, category: Category, region: string, parkType: ParkType | null, duration: string, durationDetail: string | null, difficulty: Difficulty | null, dogFriendly: boolean | null, coverImage: string, galleryImages: Array<string> | null, allTrailsUrl: string | null, allTrailsRating: number | null, hikeDistanceMiles: number | null, hikeElevationFeet: number | null, cuisine: string | null, priceRange: string | null, hours: string | null, reservationUrl: string | null, menuUrl: string | null, dietary: Array<string> | null, completed: boolean | null, completedDate: string | null, notes: string | null, location: { city: string, coords: { lat: number, lng: number } } }> };

export type CompletedQueryVariables = Exact<{ [key: string]: never; }>;


export type CompletedQuery = { completed: Array<{ __typename: 'CompletedEntry', id: string, completed: boolean }> };

export type TripsListQueryVariables = Exact<{ [key: string]: never; }>;


export type TripsListQuery = { trips: Array<{ id: string, creatorEmail: string, title: string, description: string | null, startDate: string, endDate: string, coverImageUrl: string | null, status: TripStatus, createdAt: string, markedPastAt: string | null, scheduledCount: number, unscheduledCount: number }> };

export type TripDetailQueryVariables = Exact<{
  id: string | number;
}>;


export type TripDetailQuery = { trip: { id: string, creatorEmail: string, title: string, description: string | null, startDate: string, endDate: string, coverImageUrl: string | null, status: TripStatus, createdAt: string, markedPastAt: string | null, activities: Array<{ id: string, tripId: string, activityId: string | null, addedByEmail: string, addedAt: string, dayIndex: number | null, startTime: string | null, displayOrder: number, snapshot: { id: string | null, name: string | null, shortDescription: string | null, longDescription: string | null, category: Category | null, region: string | null, parkType: ParkType | null, duration: string | null, durationDetail: string | null, difficulty: Difficulty | null, dogFriendly: boolean | null, coverImage: string | null, galleryImages: Array<string> | null, allTrailsUrl: string | null, allTrailsRating: number | null, hikeDistanceMiles: number | null, hikeElevationFeet: number | null, cuisine: string | null, priceRange: string | null, hours: string | null, reservationUrl: string | null, menuUrl: string | null, dietary: Array<string> | null, completed: boolean | null, completedDate: string | null, notes: string | null, location: { city: string, coords: { lat: number, lng: number } } | null } | null }>, members: Array<{ email: string, displayName: string | null, addedByEmail: string, addedAt: string, isCreator: boolean }>, invites: Array<{ inviteToken: string, invitedEmail: string | null, invitedByEmail: string, invitedAt: string }>, votes: Array<{ __typename: 'TripVote', tripActivityId: string, memberEmail: string, value: number }> } | null };

export type UsersListQueryVariables = Exact<{ [key: string]: never; }>;


export type UsersListQuery = { users: Array<{ email: string, displayName: string | null }> };

export type DiscoverQueryVariables = Exact<{
  range?: DiscoverRange | null | undefined;
}>;


export type DiscoverQuery = { discover: { range: DiscoverRange, events: Array<{ name: string | null, dateText: string | null, startDate: string | null, endDate: string | null, location: string | null, blurb: string | null, sourceUrl: string | null }>, sources: Array<{ uri: string | null, title: string | null }> } };

export type SaveActivityMutationVariables = Exact<{
  input: SaveActivityInput;
}>;


export type SaveActivityMutation = { saveActivity: { activity: { id: string } } };

export type DeleteActivityMutationVariables = Exact<{
  input: DeleteActivityInput;
}>;


export type DeleteActivityMutation = { deleteActivity: { deletedId: string } };

export type SetCompletedMutationVariables = Exact<{
  input: SetCompletedInput;
}>;


export type SetCompletedMutation = { setCompleted: { __typename: 'SetCompletedPayload', id: string, completed: boolean | null } };

export type GenerateActivityMutationVariables = Exact<{
  input: GenerateActivityInput;
}>;


export type GenerateActivityMutation = { generateActivity: { activity: { name: string, shortDescription: string, longDescription: string | null, category: Category, region: string, parkType: ParkType | null, city: string, lat: number, lng: number, duration: string, durationDetail: string | null, difficulty: Difficulty | null, dogFriendly: boolean | null, hikeDistanceMiles: number | null, hikeElevationFeet: number | null, cuisine: string | null, priceRange: string | null, hours: string | null, reservationUrl: string | null, menuUrl: string | null, dietary: Array<string> | null, allTrailsUrl: string | null, notes: string | null, coverImage: string | null } } };

export type AlltrailsLookupMutationVariables = Exact<{
  input: AlltrailsLookupInput;
}>;


export type AlltrailsLookupMutation = { alltrailsLookup: { lookup: { allTrailsRating: number | null, hikeDistanceMiles: number | null, hikeElevationFeet: number | null } } };

export type CreateTripMutationVariables = Exact<{
  input: CreateTripInput;
}>;


export type CreateTripMutation = { createTrip: { trip: { id: string } } };

export type PatchTripMutationVariables = Exact<{
  input: PatchTripInput;
}>;


export type PatchTripMutation = { patchTrip: { trip: { id: string } } };

export type DeleteTripMutationVariables = Exact<{
  input: DeleteTripInput;
}>;


export type DeleteTripMutation = { deleteTrip: { deletedId: string } };

export type AddTripActivityMutationVariables = Exact<{
  input: AddTripActivityInput;
}>;


export type AddTripActivityMutation = { addTripActivity: { tripActivity: { id: string } } };

export type AssignSlotMutationVariables = Exact<{
  input: AssignSlotInput;
}>;


export type AssignSlotMutation = { assignSlot: { tripActivity: { id: string } } };

export type SetDisplayOrderMutationVariables = Exact<{
  input: SetDisplayOrderInput;
}>;


export type SetDisplayOrderMutation = { setDisplayOrder: { tripActivity: { id: string } } };

export type RemoveTripActivityMutationVariables = Exact<{
  input: RemoveTripActivityInput;
}>;


export type RemoveTripActivityMutation = { removeTripActivity: { deletedId: string } };

export type CastVoteMutationVariables = Exact<{
  input: CastVoteInput;
}>;


export type CastVoteMutation = { castVote: { vote: { __typename: 'TripVote', tripActivityId: string, memberEmail: string, value: number } | null } };

export type TransitionTripMutationVariables = Exact<{
  input: TransitionTripInput;
}>;


export type TransitionTripMutation = { transitionTrip: { ok: boolean, status: TripStatus | null, kept: number | null, markedPastAt: string | null, completedActivityIds: Array<string> | null, uncompletedActivityIds: Array<string> | null } };

export type InviteMemberMutationVariables = Exact<{
  input: InviteMemberInput;
}>;


export type InviteMemberMutation = { inviteMember: { invite: { inviteToken: string, invitedEmail: string | null, invitedByEmail: string, invitedAt: string } } };

export type RemoveMemberMutationVariables = Exact<{
  input: RemoveMemberInput;
}>;


export type RemoveMemberMutation = { removeMember: { removedEmail: string } };

export type RevokeInviteMutationVariables = Exact<{
  input: RevokeInviteInput;
}>;


export type RevokeInviteMutation = { revokeInvite: { revokedToken: string } };

export type ClaimInviteMutationVariables = Exact<{
  input: ClaimInviteInput;
}>;


export type ClaimInviteMutation = { claimInvite: { tripId: string | null } | null };


export const ActivitiesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Activities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"shortDescription"}},{"kind":"Field","name":{"kind":"Name","value":"longDescription"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"region"}},{"kind":"Field","name":{"kind":"Name","value":"parkType"}},{"kind":"Field","name":{"kind":"Name","value":"location"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"coords"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lat"}},{"kind":"Field","name":{"kind":"Name","value":"lng"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"durationDetail"}},{"kind":"Field","name":{"kind":"Name","value":"difficulty"}},{"kind":"Field","name":{"kind":"Name","value":"dogFriendly"}},{"kind":"Field","name":{"kind":"Name","value":"coverImage"}},{"kind":"Field","name":{"kind":"Name","value":"galleryImages"}},{"kind":"Field","name":{"kind":"Name","value":"allTrailsUrl"}},{"kind":"Field","name":{"kind":"Name","value":"allTrailsRating"}},{"kind":"Field","name":{"kind":"Name","value":"hikeDistanceMiles"}},{"kind":"Field","name":{"kind":"Name","value":"hikeElevationFeet"}},{"kind":"Field","name":{"kind":"Name","value":"cuisine"}},{"kind":"Field","name":{"kind":"Name","value":"priceRange"}},{"kind":"Field","name":{"kind":"Name","value":"hours"}},{"kind":"Field","name":{"kind":"Name","value":"reservationUrl"}},{"kind":"Field","name":{"kind":"Name","value":"menuUrl"}},{"kind":"Field","name":{"kind":"Name","value":"dietary"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}},{"kind":"Field","name":{"kind":"Name","value":"completedDate"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}}]}}]}}]} as unknown as DocumentNode<ActivitiesQuery, ActivitiesQueryVariables>;
export const CompletedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Completed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"completed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}}]}}]}}]} as unknown as DocumentNode<CompletedQuery, CompletedQueryVariables>;
export const TripsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TripsList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trips"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"creatorEmail"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"coverImageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"markedPastAt"}},{"kind":"Field","name":{"kind":"Name","value":"scheduledCount"}},{"kind":"Field","name":{"kind":"Name","value":"unscheduledCount"}}]}}]}}]} as unknown as DocumentNode<TripsListQuery, TripsListQueryVariables>;
export const TripDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TripDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"creatorEmail"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"coverImageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"markedPastAt"}},{"kind":"Field","name":{"kind":"Name","value":"activities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tripId"}},{"kind":"Field","name":{"kind":"Name","value":"activityId"}},{"kind":"Field","name":{"kind":"Name","value":"addedByEmail"}},{"kind":"Field","name":{"kind":"Name","value":"addedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dayIndex"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"displayOrder"}},{"kind":"Field","name":{"kind":"Name","value":"snapshot"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"shortDescription"}},{"kind":"Field","name":{"kind":"Name","value":"longDescription"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"region"}},{"kind":"Field","name":{"kind":"Name","value":"parkType"}},{"kind":"Field","name":{"kind":"Name","value":"location"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"coords"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lat"}},{"kind":"Field","name":{"kind":"Name","value":"lng"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"durationDetail"}},{"kind":"Field","name":{"kind":"Name","value":"difficulty"}},{"kind":"Field","name":{"kind":"Name","value":"dogFriendly"}},{"kind":"Field","name":{"kind":"Name","value":"coverImage"}},{"kind":"Field","name":{"kind":"Name","value":"galleryImages"}},{"kind":"Field","name":{"kind":"Name","value":"allTrailsUrl"}},{"kind":"Field","name":{"kind":"Name","value":"allTrailsRating"}},{"kind":"Field","name":{"kind":"Name","value":"hikeDistanceMiles"}},{"kind":"Field","name":{"kind":"Name","value":"hikeElevationFeet"}},{"kind":"Field","name":{"kind":"Name","value":"cuisine"}},{"kind":"Field","name":{"kind":"Name","value":"priceRange"}},{"kind":"Field","name":{"kind":"Name","value":"hours"}},{"kind":"Field","name":{"kind":"Name","value":"reservationUrl"}},{"kind":"Field","name":{"kind":"Name","value":"menuUrl"}},{"kind":"Field","name":{"kind":"Name","value":"dietary"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}},{"kind":"Field","name":{"kind":"Name","value":"completedDate"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"members"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"addedByEmail"}},{"kind":"Field","name":{"kind":"Name","value":"addedAt"}},{"kind":"Field","name":{"kind":"Name","value":"isCreator"}}]}},{"kind":"Field","name":{"kind":"Name","value":"invites"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteToken"}},{"kind":"Field","name":{"kind":"Name","value":"invitedEmail"}},{"kind":"Field","name":{"kind":"Name","value":"invitedByEmail"}},{"kind":"Field","name":{"kind":"Name","value":"invitedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"votes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"tripActivityId"}},{"kind":"Field","name":{"kind":"Name","value":"memberEmail"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}}]}}]}}]} as unknown as DocumentNode<TripDetailQuery, TripDetailQueryVariables>;
export const UsersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UsersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}}]}}]}}]} as unknown as DocumentNode<UsersListQuery, UsersListQueryVariables>;
export const DiscoverDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Discover"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"range"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"DiscoverRange"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"discover"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"range"},"value":{"kind":"Variable","name":{"kind":"Name","value":"range"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"range"}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"dateText"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"location"}},{"kind":"Field","name":{"kind":"Name","value":"blurb"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sources"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"uri"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]} as unknown as DocumentNode<DiscoverQuery, DiscoverQueryVariables>;
export const SaveActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SaveActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SaveActivityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"saveActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<SaveActivityMutation, SaveActivityMutationVariables>;
export const DeleteActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeleteActivityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletedId"}}]}}]}}]} as unknown as DocumentNode<DeleteActivityMutation, DeleteActivityMutationVariables>;
export const SetCompletedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetCompleted"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetCompletedInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setCompleted"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}}]}}]}}]} as unknown as DocumentNode<SetCompletedMutation, SetCompletedMutationVariables>;
export const GenerateActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GenerateActivityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"shortDescription"}},{"kind":"Field","name":{"kind":"Name","value":"longDescription"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"region"}},{"kind":"Field","name":{"kind":"Name","value":"parkType"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"lat"}},{"kind":"Field","name":{"kind":"Name","value":"lng"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"durationDetail"}},{"kind":"Field","name":{"kind":"Name","value":"difficulty"}},{"kind":"Field","name":{"kind":"Name","value":"dogFriendly"}},{"kind":"Field","name":{"kind":"Name","value":"hikeDistanceMiles"}},{"kind":"Field","name":{"kind":"Name","value":"hikeElevationFeet"}},{"kind":"Field","name":{"kind":"Name","value":"cuisine"}},{"kind":"Field","name":{"kind":"Name","value":"priceRange"}},{"kind":"Field","name":{"kind":"Name","value":"hours"}},{"kind":"Field","name":{"kind":"Name","value":"reservationUrl"}},{"kind":"Field","name":{"kind":"Name","value":"menuUrl"}},{"kind":"Field","name":{"kind":"Name","value":"dietary"}},{"kind":"Field","name":{"kind":"Name","value":"allTrailsUrl"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}},{"kind":"Field","name":{"kind":"Name","value":"coverImage"}}]}}]}}]}}]} as unknown as DocumentNode<GenerateActivityMutation, GenerateActivityMutationVariables>;
export const AlltrailsLookupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AlltrailsLookup"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AlltrailsLookupInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"alltrailsLookup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lookup"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"allTrailsRating"}},{"kind":"Field","name":{"kind":"Name","value":"hikeDistanceMiles"}},{"kind":"Field","name":{"kind":"Name","value":"hikeElevationFeet"}}]}}]}}]}}]} as unknown as DocumentNode<AlltrailsLookupMutation, AlltrailsLookupMutationVariables>;
export const CreateTripDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTrip"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTripInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTrip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trip"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateTripMutation, CreateTripMutationVariables>;
export const PatchTripDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PatchTrip"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PatchTripInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"patchTrip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trip"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<PatchTripMutation, PatchTripMutationVariables>;
export const DeleteTripDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteTrip"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeleteTripInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteTrip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletedId"}}]}}]}}]} as unknown as DocumentNode<DeleteTripMutation, DeleteTripMutationVariables>;
export const AddTripActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddTripActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddTripActivityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addTripActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tripActivity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<AddTripActivityMutation, AddTripActivityMutationVariables>;
export const AssignSlotDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AssignSlot"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AssignSlotInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"assignSlot"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tripActivity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<AssignSlotMutation, AssignSlotMutationVariables>;
export const SetDisplayOrderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetDisplayOrder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetDisplayOrderInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setDisplayOrder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tripActivity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<SetDisplayOrderMutation, SetDisplayOrderMutationVariables>;
export const RemoveTripActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveTripActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RemoveTripActivityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeTripActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletedId"}}]}}]}}]} as unknown as DocumentNode<RemoveTripActivityMutation, RemoveTripActivityMutationVariables>;
export const CastVoteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CastVote"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CastVoteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"castVote"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vote"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"tripActivityId"}},{"kind":"Field","name":{"kind":"Name","value":"memberEmail"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}}]}}]}}]} as unknown as DocumentNode<CastVoteMutation, CastVoteMutationVariables>;
export const TransitionTripDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TransitionTrip"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"TransitionTripInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transitionTrip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kept"}},{"kind":"Field","name":{"kind":"Name","value":"markedPastAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedActivityIds"}},{"kind":"Field","name":{"kind":"Name","value":"uncompletedActivityIds"}}]}}]}}]} as unknown as DocumentNode<TransitionTripMutation, TransitionTripMutationVariables>;
export const InviteMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InviteMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"InviteMemberInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteToken"}},{"kind":"Field","name":{"kind":"Name","value":"invitedEmail"}},{"kind":"Field","name":{"kind":"Name","value":"invitedByEmail"}},{"kind":"Field","name":{"kind":"Name","value":"invitedAt"}}]}}]}}]}}]} as unknown as DocumentNode<InviteMemberMutation, InviteMemberMutationVariables>;
export const RemoveMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RemoveMemberInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removedEmail"}}]}}]}}]} as unknown as DocumentNode<RemoveMemberMutation, RemoveMemberMutationVariables>;
export const RevokeInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RevokeInviteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeInvite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokedToken"}}]}}]}}]} as unknown as DocumentNode<RevokeInviteMutation, RevokeInviteMutationVariables>;
export const ClaimInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ClaimInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ClaimInviteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"claimInvite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tripId"}}]}}]}}]} as unknown as DocumentNode<ClaimInviteMutation, ClaimInviteMutationVariables>;