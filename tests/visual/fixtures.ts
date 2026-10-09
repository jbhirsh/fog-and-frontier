// Fixed fixture data for visual tests. Hand-curated for coverage:
// - long name vs short name
// - completed vs not completed
// - with and without optional fields (difficulty, rating, dogFriendly)
//
// Editing this file is the explicit way to update what visual tests cover.
// Do NOT auto-generate from prod — adding an activity in prod must not change
// visual baselines.
//
// 1x1 transparent PNG keeps fixtures self-contained — no network image needed
// during tests, so screenshots are deterministic offline.
import type { Activity } from '../../src/data/types';

const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const FIXTURES: Activity[] = [
  {
    id: 'fixture-long-name-hiking',
    name: 'A Deliberately Long Activity Name That Spans Multiple Lines on Narrow Layouts',
    shortDescription:
      'Long-name card to stress-test wrapping in the headline area on every viewport.',
    longDescription: 'Long description body content.',
    category: 'hiking',
    region: 'peninsula',
    location: { city: 'La Honda', coords: { lat: 37.317, lng: -122.275 } },
    duration: 'Half Day',
    difficulty: 'moderate',
    dogFriendly: true,
    coverImage: BLANK_PNG,
    allTrailsRating: 4.4,
    completed: false,
  },
  {
    id: 'fixture-short-food',
    name: 'Quick Bite',
    shortDescription: 'Short card with the minimum optional fields populated.',
    longDescription: 'Detail.',
    category: 'food',
    region: 'south-bay',
    location: { city: 'Campbell', coords: { lat: 37.287, lng: -121.95 } },
    duration: '1-2 Hours',
    coverImage: BLANK_PNG,
    completed: false,
  },
  {
    id: 'fixture-completed-scenic',
    name: 'Completed Scenic Drive',
    shortDescription:
      'Completed card — exercises the COMPLETED badge and the Completed only filter.',
    longDescription: 'Detail.',
    category: 'scenic',
    region: 'north-bay',
    location: { city: 'Stinson Beach', coords: { lat: 37.9, lng: -122.64 } },
    duration: 'Full Day',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage: BLANK_PNG,
    allTrailsRating: 4.8,
    completed: true,
    completedDate: '2024-01-15',
  },
];

export const fixtureActivities: Record<string, Activity> =
  Object.fromEntries(FIXTURES.map((a) => [a.id, a]));

// Overrides keyed by fixture ids only — never reference real static activity
// ids so the test stays independent of src/data/activities.ts.
export const fixtureCompleted: Record<string, boolean> = {
  'fixture-completed-scenic': true,
};

// ---- Trips (#59) -----------------------------------------------------------
// The signed-in visitor for trips snapshots: tests set
// window.__TEST_FORCE_EMAIL__ to this (see src/lib/authShim.ts).
export const FIXTURE_EMAIL = 'jess@example.com';
const FRIEND_EMAIL = 'tarun@example.com';
const AT = '2026-09-01T17:00:00.000Z';

export interface FixtureTripActivity {
  id: string;
  activityId: string;
  addedByEmail: string;
  dayIndex: number | null;
  startTime: string | null;
  displayOrder: number;
}

export interface FixtureTrip {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: 'voting' | 'planning' | 'past';
  activities: FixtureTripActivity[];
  votes: { tripActivityId: string; memberEmail: string; value: number }[];
}

// Planning: two activities scheduled on day 1, an empty day 2, and one
// activity still unscheduled, so the detail snapshot covers the map, both day
// tabs, the itinerary (filled and empty days) and the Unscheduled panel.
const PLANNING: FixtureTrip = {
  id: 'fixture-trip-planning',
  title: 'Coast Weekend',
  description: 'Two days down the coast with a stop for food.',
  startDate: '2026-11-07',
  endDate: '2026-11-08',
  status: 'planning',
  activities: [
    {
      id: 'ta-hike',
      activityId: 'fixture-long-name-hiking',
      addedByEmail: FIXTURE_EMAIL,
      dayIndex: 0,
      startTime: '09:00',
      displayOrder: 0,
    },
    {
      id: 'ta-food',
      activityId: 'fixture-short-food',
      addedByEmail: FRIEND_EMAIL,
      dayIndex: 0,
      startTime: '13:30',
      displayOrder: 1,
    },
    {
      id: 'ta-drive',
      activityId: 'fixture-completed-scenic',
      addedByEmail: FIXTURE_EMAIL,
      dayIndex: null,
      startTime: null,
      displayOrder: 0,
    },
  ],
  votes: [],
};

// Voting: every candidate unscheduled, with a mix of votes cast.
const VOTING: FixtureTrip = {
  id: 'fixture-trip-voting',
  title: 'Spring Getaway',
  description: null,
  startDate: '2027-03-20',
  endDate: '2027-03-22',
  status: 'voting',
  activities: [
    {
      id: 'tv-hike',
      activityId: 'fixture-long-name-hiking',
      addedByEmail: FIXTURE_EMAIL,
      dayIndex: null,
      startTime: null,
      displayOrder: 0,
    },
    {
      id: 'tv-food',
      activityId: 'fixture-short-food',
      addedByEmail: FRIEND_EMAIL,
      dayIndex: null,
      startTime: null,
      displayOrder: 1,
    },
    {
      id: 'tv-drive',
      activityId: 'fixture-completed-scenic',
      addedByEmail: FRIEND_EMAIL,
      dayIndex: null,
      startTime: null,
      displayOrder: 2,
    },
  ],
  votes: [
    { tripActivityId: 'tv-hike', memberEmail: FIXTURE_EMAIL, value: 1 },
    { tripActivityId: 'tv-hike', memberEmail: FRIEND_EMAIL, value: 1 },
    { tripActivityId: 'tv-food', memberEmail: FRIEND_EMAIL, value: -1 },
  ],
};

export const fixtureTrips: Record<string, FixtureTrip> = {
  [PLANNING.id]: PLANNING,
  [VOTING.id]: VOTING,
};

export const fixtureTripMembers = [
  { email: FIXTURE_EMAIL, displayName: 'Jess', addedByEmail: FIXTURE_EMAIL, addedAt: AT, isCreator: true },
  { email: FRIEND_EMAIL, displayName: 'Tarun', addedByEmail: FIXTURE_EMAIL, addedAt: AT, isCreator: false },
];

export const FIXTURE_TRIP_CREATED_AT = AT;
