import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { muirWoods } from '../test/fixtures';
import type { Activity } from '../data/types';
import { NearbyHeading, NearbyList } from './NearbyList';

const near = (id: string, name: string, category: Activity['category']): Activity => ({
  ...muirWoods,
  id,
  name,
  category,
  duration: 'Half Day',
  location: { ...muirWoods.location, city: 'Felton' },
});

const LIBRARY = near('library', 'Los Gatos Library', 'culture');
const CASTLE = {
  ...near('castle', 'Castle Rock State Park (Ridge Loop)', 'hiking'),
  cardName: 'Castle Rock',
};
const UMUNHUM = near('umunhum', 'Mount Umunhum Summit Trail', 'hiking');

function show() {
  const onSelect = vi.fn();
  render(
    <NearbyList
      city="Los Gatos"
      onSelect={onSelect}
      groups={[
        { category: 'culture', items: [{ activity: LIBRARY, miles: 1.46 }] },
        {
          category: 'hiking',
          items: [
            { activity: CASTLE, miles: 6.4 },
            { activity: UMUNHUM, miles: 6.84 },
          ],
        },
      ]}
    />,
  );
  return { onSelect };
}

describe('NearbyList', () => {
  it('says how far it looked, from where', () => {
    show();
    const nearby = screen.getByRole('region', { name: 'Nearby' });
    expect(within(nearby).getByRole('heading', { level: 3, name: 'Nearby' })).toBeInTheDocument();
    expect(within(nearby).getByText('Within 15 miles of Los Gatos')).toBeInTheDocument();
  });

  it('groups the places by kind, in the order given, under their kind’s heading', () => {
    show();
    const groups = screen.getAllByRole('region').filter((r) => r.getAttribute('aria-labelledby'));
    expect(groups.map((g) => within(g).getByRole('heading', { level: 4 }).textContent)).toEqual([
      'museumNearby culture',
      'directions_walkNearby hikes',
    ]);
    const hikes = within(groups[1]).getAllByRole('button');
    expect(hikes.map((b) => b.textContent)).toEqual([
      'Castle RockFelton · 6.4 mi · Half Daychevron_right',
      'Mount Umunhum Summit TrailFelton · 6.8 mi · Half Daychevron_right',
    ]);
  });

  it('opens a place when its row is tapped', async () => {
    const { onSelect } = show();
    await userEvent.click(screen.getByRole('button', { name: /Los Gatos Library/ }));
    expect(onSelect).toHaveBeenCalledWith(LIBRARY);
  });

  it('keeps the rows a finger’s height', () => {
    show();
    for (const row of screen.getAllByRole('button')) expect(row).toHaveClass('min-h-14');
  });
});

describe('NearbyHeading', () => {
  it('names its kind beside the kind’s symbol, which a reader skips', () => {
    render(<NearbyHeading id="h" category="water" />);
    const heading = screen.getByRole('heading', { level: 4, name: 'Nearby on the water' });
    expect(heading).toHaveAttribute('id', 'h');
    expect(within(heading).getByText('water')).toHaveAttribute('aria-hidden', 'true');
  });
});
