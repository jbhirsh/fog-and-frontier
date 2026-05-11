// Fixed fixture data for visual tests. Hand-curated for coverage:
// - long name vs short name
// - completed vs not completed
// - with and without photos
//
// Editing this file is the explicit way to update what visual tests cover.
// Do NOT auto-generate from prod — adding an activity in prod must not change
// visual baselines.

export const fixtureActivities = {
  'fixture-long-name': {
    id: 'fixture-long-name',
    name: 'A Deliberately Long Activity Name That Spans Multiple Lines on Narrow Layouts',
    shortDescription: 'Short description.',
    longDescription: 'A long description that wraps and provides body content for the card.',
    location: { label: 'Somewhere, CA', coords: { lat: 37.5, lng: -122.3 } },
    completed: false,
    category: 'outdoor',
  },
  'fixture-short': {
    id: 'fixture-short',
    name: 'Quick Run',
    shortDescription: 'Just a quick one.',
    longDescription: 'Detail.',
    location: { label: 'Local', coords: { lat: 37.3, lng: -122.0 } },
    completed: true,
    category: 'fitness',
  },
};

export const fixtureCompleted: Record<string, boolean> = {
  'mt-diablo-summit': true,
  'filoli-gardens': true,
};
