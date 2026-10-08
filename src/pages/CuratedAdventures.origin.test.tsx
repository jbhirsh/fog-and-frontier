import { describe, expect, it } from 'vitest';
import { render, screen, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { muirWoods } from '../test/fixtures';
import { distanceMiles } from '../data/home';
import {
  deviceOrigin,
  DistanceOriginCtx,
  HOME_ORIGIN,
  type DistanceOrigin,
} from '../lib/distanceOrigin';
import { CuratedAdventures } from './CuratedAdventures';

// Distances say where they're measured from (#66): "from you" once the
// visitor shares their location, "from San Jose" otherwise.

// About 10 miles south of Muir Woods.
const NEAR_SF = deviceOrigin({ latitude: 37.75, longitude: -122.45 });

function renderAt(origin: DistanceOrigin) {
  return render(
    <DistanceOriginCtx.Provider value={origin}>
      <MemoryRouter>
        <CuratedAdventures />
      </MemoryRouter>
    </DistanceOriginCtx.Provider>,
    { activities: [muirWoods] },
  );
}

function badge(origin: DistanceOrigin) {
  const miles = distanceMiles(origin.coords, muirWoods.location.coords);
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi from ${origin.name}`;
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
    const miles = distanceMiles(NEAR_SF.coords, muirWoods.location.coords);
    expect(within(dialog).getByText(`${miles.toFixed(1)} mi from you`)).toBeInTheDocument();
  });
});
