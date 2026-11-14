import type { Trip, TripActivity, TripListItem, TripMember } from '../lib/userTrips';
import { muirWoods } from './fixtures';

// Trips as the API returns them, for tests to override what they look at.

const JESS = 'jess@example.com';

// A trip as useTripsList returns it, planning by default.
export function tripListItem(overrides: Partial<TripListItem> = {}): TripListItem {
  return {
    id: 'trip-1',
    creator_email: 'owner@example.com',
    title: 'Big Sur',
    description: null,
    start_date: '2026-03-03',
    end_date: '2026-03-05',
    cover_image_url: null,
    status: 'planning',
    created_at: 0,
    marked_past_at: null,
    scheduled_count: 0,
    unscheduled_count: 0,
    ...overrides,
  };
}

// A place on trip-1, added by Jess and unscheduled: catalog place `act-<id>`,
// named `Place <id>`.
export function tripActivity(id: string, overrides: Partial<TripActivity> = {}): TripActivity {
  return {
    id,
    trip_id: 'trip-1',
    activity_id: `act-${id}`,
    added_by_email: JESS,
    added_at: 0,
    day_index: null,
    start_time: null,
    display_order: 0,
    snapshot: { ...muirWoods, id: `act-${id}`, name: `Place ${id}` },
    ...overrides,
  };
}

function tripMember(email: string, display_name: string | null, is_creator = false): TripMember {
  return { email, display_name, added_by_email: JESS, added_at: 0, is_creator };
}

// A trip as useTrip returns it: Jess's two-day planning trip, with Tarun a
// member and nothing on it yet.
export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    creator_email: JESS,
    title: 'Coast Weekend',
    description: null,
    start_date: '2026-04-11',
    end_date: '2026-04-12',
    cover_image_url: null,
    status: 'planning',
    created_at: 0,
    marked_past_at: null,
    activities: [],
    members: [tripMember(JESS, 'Jess', true), tripMember('tarun@example.com', null)],
    invites: [],
    votes: [],
    ...overrides,
  };
}
