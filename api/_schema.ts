// GraphQL schema (SDL) for the consolidated API — see issue #91 + the migration plan.
// Single source of truth; resolvers in api/_resolvers/* implement this contract.
// Custom scalars (DateTimeISO, Date, LocalTime) come from graphql-scalars and are
// wired into the resolver map (not declared here beyond `scalar`).
//
// Conventions: camelCase fields (DB stays snake_case; mapped at the resolver boundary);
// every mutation takes a single `input` object and returns a dedicated `XxxPayload`;
// catalog `Activity` is strict non-null, the trip's frozen `ActivitySnapshot` is a
// separate embedded all-nullable type (resolver null-coerces a nonconforming snapshot).

export const typeDefs = /* GraphQL */ `
  scalar DateTimeISO   # ISO-8601 datetime string; DB epoch-ms -> ISO
  scalar Date          # 'YYYY-MM-DD'
  scalar LocalTime     # 'HH:MM' 24h, no tz

  enum Category { hiking cycling water food culture scenic climbing camping other }
  enum Difficulty { easy moderate advanced }
  enum ParkType { national state regional county city private none }
  enum TripStatus { voting planning past }
  enum UserRole { owner editor }
  enum DiscoverRange { today tomorrow week weekend }

  type Coords { lat: Float!  lng: Float! }
  type Location { city: String!  coords: Coords! }

  "Catalog activity — strict non-null; normalized by id."
  type Activity {
    id: ID!
    name: String!
    shortDescription: String!
    longDescription: String
    category: Category!
    region: String!
    parkType: ParkType
    location: Location!
    duration: String!
    durationDetail: String
    difficulty: Difficulty
    dogFriendly: Boolean
    coverImage: String!
    galleryImages: [String!]
    allTrailsUrl: String
    allTrailsRating: Float
    hikeDistanceMiles: Float
    hikeElevationFeet: Float
    cuisine: String
    priceRange: String
    hours: String
    reservationUrl: String
    menuUrl: String
    dietary: [String!]
    completed: Boolean
    completedDate: Date
    notes: String
  }

  "Frozen copy stored on a trip — embedded (keyFields:false), all-nullable to tolerate pre-validation rows."
  type ActivitySnapshot {
    id: ID
    name: String
    shortDescription: String
    longDescription: String
    category: Category
    region: String
    parkType: ParkType
    location: Location
    duration: String
    durationDetail: String
    difficulty: Difficulty
    dogFriendly: Boolean
    coverImage: String
    galleryImages: [String!]
    allTrailsUrl: String
    allTrailsRating: Float
    hikeDistanceMiles: Float
    hikeElevationFeet: Float
    cuisine: String
    priceRange: String
    hours: String
    reservationUrl: String
    menuUrl: String
    dietary: [String!]
    completed: Boolean
    completedDate: Date
    notes: String
  }

  type CompletedEntry { id: ID!  completed: Boolean! }

  type Trip {
    id: ID!
    creatorEmail: String!
    title: String!
    description: String
    startDate: Date!
    endDate: Date!
    coverImageUrl: String
    status: TripStatus!
    createdAt: DateTimeISO!
    markedPastAt: DateTimeISO
    activities: [TripActivity!]!
    members: [TripMember!]!
    invites: [TripInvite!]!
    votes: [TripVote!]!
  }

  type TripListItem {
    id: ID!
    creatorEmail: String!
    title: String!
    description: String
    startDate: Date!
    endDate: Date!
    coverImageUrl: String
    status: TripStatus!
    createdAt: DateTimeISO!
    markedPastAt: DateTimeISO
    scheduledCount: Int!
    unscheduledCount: Int!
  }

  type TripActivity {
    id: ID!
    tripId: ID!
    activityId: ID
    addedByEmail: String!
    addedAt: DateTimeISO!
    dayIndex: Int
    startTime: LocalTime
    displayOrder: Int!
    snapshot: ActivitySnapshot
  }

  "Embedded under Trip (keyFields:false) — per-trip, no global identity."
  type TripMember {
    email: String!
    displayName: String
    addedByEmail: String!
    addedAt: DateTimeISO!
    isCreator: Boolean!
  }

  type TripInvite {
    inviteToken: String!
    invitedEmail: String
    invitedByEmail: String!
    invitedAt: DateTimeISO!
  }

  type TripVote {
    tripActivityId: ID!
    memberEmail: String!
    value: Int!
  }

  type User { email: String!  displayName: String }

  type DiscoverResult {
    range: DiscoverRange!
    events: [DiscoverEvent!]!
    sources: [DiscoverSource!]!
  }
  "All-nullable: unvalidated live model output."
  type DiscoverEvent {
    name: String
    dateText: String
    startDate: String
    endDate: String
    location: String
    blurb: String
    sourceUrl: String
  }
  type DiscoverSource { uri: String  title: String }

  type AllTrailsLookup {
    allTrailsRating: Float
    hikeDistanceMiles: Float
    hikeElevationFeet: Float
  }

  "Gemini output (responseSchema-constrained); optional fields nullable."
  type GeneratedActivity {
    name: String!
    shortDescription: String!
    longDescription: String
    category: Category!
    region: String!
    parkType: ParkType
    city: String!
    lat: Float!
    lng: Float!
    duration: String!
    durationDetail: String
    difficulty: Difficulty
    dogFriendly: Boolean
    hikeDistanceMiles: Float
    hikeElevationFeet: Float
    cuisine: String
    priceRange: String
    hours: String
    reservationUrl: String
    menuUrl: String
    dietary: [String!]
    allTrailsUrl: String
    notes: String
    coverImage: String
  }

  input CoordsInput { lat: Float!  lng: Float! }
  input LocationInput { city: String!  coords: CoordsInput! }
  input ActivityInput {
    name: String!
    shortDescription: String!
    longDescription: String
    category: Category!
    region: String!
    parkType: ParkType
    location: LocationInput!
    duration: String!
    durationDetail: String
    difficulty: Difficulty
    dogFriendly: Boolean
    coverImage: String!
    galleryImages: [String!]
    allTrailsUrl: String
    allTrailsRating: Float
    hikeDistanceMiles: Float
    hikeElevationFeet: Float
    cuisine: String
    priceRange: String
    hours: String
    reservationUrl: String
    menuUrl: String
    dietary: [String!]
    completed: Boolean
    completedDate: Date
    notes: String
  }
  input SaveActivityInput { id: ID!  activity: ActivityInput! }
  input DeleteActivityInput { id: ID! }
  input SetCompletedInput { id: ID!  value: Boolean }
  input GenerateActivityInput { title: String!  notes: String }
  input AlltrailsLookupInput { url: String! }
  input CreateTripInput {
    title: String!
    startDate: Date!
    endDate: Date!
    description: String
    coverImageUrl: String
    initialActivityIds: [ID!]
    status: TripStatus
  }
  input PatchTripFieldsInput {
    title: String
    description: String
    startDate: Date
    endDate: Date
    coverImageUrl: String
  }
  input PatchTripInput { id: ID!  patch: PatchTripFieldsInput! }
  input DeleteTripInput { id: ID! }
  input AddTripActivityInput { tripId: ID!  activityId: ID! }
  input AssignSlotInput { taId: ID!  dayIndex: Int  startTime: LocalTime  displayOrder: Int }
  input SetDisplayOrderInput { taId: ID!  displayOrder: Int! }
  input RemoveTripActivityInput { taId: ID! }
  input CastVoteInput { tripId: ID!  tripActivityId: ID!  value: Int! }
  input TransitionTripInput {
    id: ID!
    to: TripStatus!
    keptActivityIds: [ID!]
    completedActivityIds: [ID!]
  }
  input InviteMemberInput { tripId: ID!  email: String! }
  input RemoveMemberInput { tripId: ID!  email: String! }
  input RevokeInviteInput { tripId: ID!  token: String! }
  input ClaimInviteInput { inviteToken: String! }

  type SaveActivityPayload { activity: Activity! }
  type DeleteActivityPayload { deletedId: ID! }
  type SetCompletedPayload { id: ID!  completed: Boolean }
  type GenerateActivityPayload { activity: GeneratedActivity! }
  type AlltrailsLookupPayload { lookup: AllTrailsLookup! }
  type CreateTripPayload { trip: Trip! }
  type PatchTripPayload { trip: Trip! }
  type DeleteTripPayload { deletedId: ID! }
  type AddTripActivityPayload { tripActivity: TripActivity! }
  type AssignSlotPayload { tripActivity: TripActivity! }
  type SetDisplayOrderPayload { tripActivity: TripActivity! }
  type RemoveTripActivityPayload { deletedId: ID! }
  type CastVotePayload { vote: TripVote }
  type TripTransitionPayload {
    ok: Boolean!
    status: TripStatus
    kept: Int
    markedPastAt: DateTimeISO
    completedActivityIds: [ID!]
    uncompletedActivityIds: [ID!]
  }
  type InviteMemberPayload { invite: TripInvite! }
  type RemoveMemberPayload { removedEmail: String! }
  type RevokeInvitePayload { revokedToken: String! }
  type ClaimInvitePayload { tripId: ID }

  type Query {
    activities: [Activity!]!
    completed: [CompletedEntry!]!
    trips: [TripListItem!]!
    trip(id: ID!): Trip
    users: [User!]!
    discover(range: DiscoverRange = weekend): DiscoverResult!
  }

  type Mutation {
    saveActivity(input: SaveActivityInput!): SaveActivityPayload!
    deleteActivity(input: DeleteActivityInput!): DeleteActivityPayload!
    setCompleted(input: SetCompletedInput!): SetCompletedPayload!
    generateActivity(input: GenerateActivityInput!): GenerateActivityPayload!
    alltrailsLookup(input: AlltrailsLookupInput!): AlltrailsLookupPayload!
    createTrip(input: CreateTripInput!): CreateTripPayload!
    patchTrip(input: PatchTripInput!): PatchTripPayload!
    deleteTrip(input: DeleteTripInput!): DeleteTripPayload!
    addTripActivity(input: AddTripActivityInput!): AddTripActivityPayload!
    assignSlot(input: AssignSlotInput!): AssignSlotPayload!
    setDisplayOrder(input: SetDisplayOrderInput!): SetDisplayOrderPayload!
    removeTripActivity(input: RemoveTripActivityInput!): RemoveTripActivityPayload!
    castVote(input: CastVoteInput!): CastVotePayload!
    transitionTrip(input: TransitionTripInput!): TripTransitionPayload!
    inviteMember(input: InviteMemberInput!): InviteMemberPayload!
    removeMember(input: RemoveMemberInput!): RemoveMemberPayload!
    revokeInvite(input: RevokeInviteInput!): RevokeInvitePayload!
    claimInvite(input: ClaimInviteInput!): ClaimInvitePayload
  }
`;
