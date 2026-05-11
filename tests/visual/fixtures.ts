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
      'Completed card — exercises the COMPLETED badge and the Adventures route.',
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
