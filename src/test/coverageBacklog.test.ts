import { describe, expect, it } from 'vitest';
import { coverageBacklog } from './coverageGlobs';

// The coverage backlog in vite.config.ts (files excluded from the 80%
// per-file gate because they predate it) may only shrink. This pins it to the
// files in it today: a new file goes in the backlog only by editing this list
// too, which a reviewer sees, and a file that leaves the backlog (because it
// got tests) must leave this list in the same change, so the pin ratchets down.
const PINNED_BACKLOG = [
  'api/_db.ts',
  'api/_gqlMap.ts',
  'api/_resolvers/gemini.ts',
  'api/_trips.ts',
  'api/graphql.ts',
  'src/components/ActivityCard.tsx',
  'src/components/ActivityDetail.tsx',
  'src/components/ActivityMap.tsx',
  'src/components/AddActivity.tsx',
  'src/components/AddToTripDialog.tsx',
  'src/components/AddToTripDropdown.tsx',
  'src/components/InviteModal.tsx',
  'src/components/Layout.tsx',
  'src/components/MapZoomControls.tsx',
  'src/components/TripActivityCard.tsx',
  'src/components/TripMap.tsx',
  'src/components/VoteControls.tsx',
  'src/components/VotingCandidateCard.tsx',
  'src/lib/alltrails.ts',
  'src/lib/apolloClient.ts',
  'src/lib/authShimClerk.tsx',
  'src/lib/generateActivity.ts',
  'src/lib/gqlError.ts',
  'src/lib/userActivities.ts',
  'src/lib/userTrips.ts',
  'src/lib/useTripMembership.ts',
  'src/lib/useVisibilityInterval.ts',
  'src/pages/CuratedAdventures.tsx',
  'src/pages/Explore.tsx',
  'src/pages/NewTrip.tsx',
  'src/pages/TripDetail.tsx',
  'src/pages/Trips.tsx',
];

// Every source file the coverage gate could measure, as repo-relative paths.
// Lazy globs: only the keys are read, nothing is imported.
const sourceFiles = new Set(
  Object.keys(
    import.meta.glob(['/src/**/*.{ts,tsx}', '/api/**/*.ts']),
  ).map((path) => path.slice(1)),
);

describe('coverage backlog', () => {
  const backlog = coverageBacklog();

  it('finds the backlog in vite.config.ts', () => {
    expect(backlog.length).toBeGreaterThan(0);
  });

  it('does not grow', () => {
    const added = backlog.filter((file) => !PINNED_BACKLOG.includes(file));
    expect(
      added,
      'New file(s) in the vite.config.ts coverage backlog. Write tests that ' +
        'meet the 80% per-file gate instead; the backlog may only shrink.',
    ).toEqual([]);
  });

  it('ratchets down when a file leaves it', () => {
    const removed = PINNED_BACKLOG.filter((file) => !backlog.includes(file));
    expect(
      removed,
      'File(s) left the vite.config.ts coverage backlog. Delete them from ' +
        'PINNED_BACKLOG in src/test/coverageBacklog.test.ts too, so they ' +
        'cannot be added back.',
    ).toEqual([]);
  });

  it('names only files that exist', () => {
    const missing = backlog.filter((file) => !sourceFiles.has(file));
    expect(
      missing,
      'Coverage backlog entries that name no existing file. Remove them from ' +
        'vite.config.ts and from PINNED_BACKLOG.',
    ).toEqual([]);
  });
});
