import { describe, expect, it } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';
import { ActivityPermalinkRoutes } from '../components/ActivityPermalinkRoutes';
import { muirWoods } from '../test/fixtures';
import {
  deviceOrigin,
  DistanceOriginCtx,
  HOME_ORIGIN,
  type DistanceOrigin,
} from '../lib/distanceOrigin';
import {
  DrivingMilesCtx,
  NO_DRIVING_MILES,
  distanceTo,
  formatMiles,
  type DrivingMiles,
} from '../lib/drivingMiles';
import { CuratedAdventures } from './CuratedAdventures';

// Distances say where they're measured from (#66): "from you" once the
// visitor shares their location, "from San Jose" otherwise.

// About 10 miles south of Muir Woods.
const NEAR_SF = deviceOrigin({ latitude: 37.75, longitude: -122.45 });

function renderAt(origin: DistanceOrigin, driving: DrivingMiles = NO_DRIVING_MILES) {
  return render(
    <DistanceOriginCtx.Provider value={origin}>
      <DrivingMilesCtx.Provider value={driving}>
        <MemoryRouter>
          <ActivityPermalinkRoutes>
            <Route path="*" element={<CuratedAdventures />} />
          </ActivityPermalinkRoutes>
        </MemoryRouter>
      </DrivingMilesCtx.Provider>
    </DistanceOriginCtx.Provider>,
    { activities: [muirWoods] },
  );
}

// Before road miles load, the badge is the straight-line estimate ("≈").
function badge(origin: DistanceOrigin, driving: DrivingMiles = NO_DRIVING_MILES) {
  return `${formatMiles(distanceTo(origin, driving, muirWoods))} mi from ${origin.name}`;
}

describe('Curated Adventures — distance origin (#66)', () => {
  it('measures from home, and says so, until the visitor shares a location', () => {
    renderAt(HOME_ORIGIN);
    expect(screen.getByText(/sorted by\s+distance from San Jose, CA/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Within 25 mi of San Jose' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Any distance' })).toBeInTheDocument();
    expect(screen.getByText(badge(HOME_ORIGIN))).toBeInTheDocument();
  });

  it('measures from the visitor, and says "you"', () => {
    renderAt(NEAR_SF);
    expect(screen.getByText(/sorted by\s+distance from you/)).toBeInTheDocument();
    for (const miles of [25, 50, 100, 250]) {
      expect(
        screen.getByRole('option', { name: `Within ${miles} mi of you` }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(badge(NEAR_SF))).toBeInTheDocument();
  });

  it('filters by distance from the visitor, not from home', async () => {
    // Muir Woods is ~10 mi from the visitor but ~55 from San Jose.
    const { unmount } = renderAt(NEAR_SF);
    await userEvent.selectOptions(
      screen.getByDisplayValue('Any distance'),
      'Within 25 mi of you',
    );
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    unmount();

    renderAt(HOME_ORIGIN);
    await userEvent.selectOptions(
      screen.getByDisplayValue('Any distance'),
      'Within 25 mi of San Jose',
    );
    expect(screen.queryByText('Test Muir Woods')).not.toBeInTheDocument();
  });

  it('labels the detail view with the same origin', async () => {
    renderAt(NEAR_SF);
    await userEvent.click(screen.getByRole('button', { name: /Test Muir Woods/ }));
    const dialog = await screen.findByRole('dialog');
    const miles = formatMiles(distanceTo(NEAR_SF, NO_DRIVING_MILES, muirWoods), true);
    expect(within(dialog).getByText(`${miles} mi from you`)).toBeInTheDocument();
  });

  it('shows, filters and details by road miles once they load', async () => {
    // Straight-line, Muir Woods is ~55 mi from San Jose; say it's 20 by road.
    const driving = new Map([[muirWoods.id, 20]]);
    renderAt(HOME_ORIGIN, driving);
    expect(screen.getByText('20 mi from San Jose')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByDisplayValue('Any distance'),
      'Within 25 mi of San Jose',
    );
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Test Muir Woods/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('20.0 mi from San Jose, CA')).toBeInTheDocument();
  });
});
