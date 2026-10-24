import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '../test/render';
import type { Activity } from '../data/types';
import { muirWoods } from '../test/fixtures';
import { ActivityDetail } from './ActivityDetail';

// A park and its hikes and stops on the detail page (#269).

const PARK: Activity = {
  ...muirWoods,
  id: 'test-park',
  name: 'Test Seashore',
  category: 'scenic',
};
const LIGHTHOUSE: Activity = {
  ...muirWoods,
  id: 'test-lighthouse',
  name: 'Test Lighthouse',
  category: 'scenic',
  duration: 'Full Day',
  parentId: PARK.id,
};
const CHIMNEY: Activity = {
  ...muirWoods,
  id: 'test-chimney',
  name: 'Test Chimney Rock',
  parentId: PARK.id,
};
// Nearby, in no park: still offered under Nearby.
const TACOS: Activity = {
  ...muirWoods,
  id: 'test-tacos',
  name: 'Trailside Tacos',
  category: 'food',
};

const ALL = [PARK, LIGHTHOUSE, CHIMNEY, TACOS];

describe('a park’s hikes and stops on the detail page (#269)', () => {
  // Opening another activity in place scrolls the panel back to its top.
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  it('lists a park’s own, by name, and doesn’t offer them again as nearby', () => {
    render(<ActivityDetail activity={PARK} onClose={() => {}} />, { activities: ALL });
    const own = screen.getByRole('heading', { name: 'Hikes & stops here' }).closest('section')!;
    const names = within(own)
      .getAllByRole('button')
      .map((b) => within(b).getByRole('img').getAttribute('alt'));
    expect(names).toEqual(['Test Chimney Rock', 'Test Lighthouse']);
    expect(within(own).getByText('Scenic')).toBeInTheDocument();
    expect(within(own).getByText('Full Day')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nearby hikes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nearby scenic spots' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nearby food' })).toBeInTheDocument();
    // A park is part of nothing.
    expect(screen.queryByRole('button', { name: /^Part of/ })).not.toBeInTheDocument();
  });

  it('links a hike up to its park, and across to the park’s others', () => {
    render(<ActivityDetail activity={LIGHTHOUSE} onClose={() => {}} />, { activities: ALL });
    expect(screen.getByRole('button', { name: /Part of Test Seashore/ })).toBeInTheDocument();
    const others = screen
      .getByRole('heading', { name: 'Also in Test Seashore' })
      .closest('section')!;
    expect(within(others).getAllByRole('button')).toHaveLength(1);
    expect(within(others).getByRole('button', { name: /Test Chimney Rock/ })).toBeInTheDocument();
    // Neither the park nor its other hike is offered again as nearby.
    expect(screen.queryByRole('region', { name: 'Nearby hikes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nearby scenic spots' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hikes & stops here' })).not.toBeInTheDocument();
  });

  it('opens the park from the link', async () => {
    const onSelectNearby = vi.fn();
    render(
      <ActivityDetail activity={LIGHTHOUSE} onClose={() => {}} onSelectNearby={onSelectNearby} />,
      { activities: ALL },
    );
    await userEvent.click(screen.getByRole('button', { name: /Part of Test Seashore/ }));
    expect(onSelectNearby).toHaveBeenCalledWith(PARK);
    await userEvent.click(screen.getByRole('button', { name: /Test Chimney Rock/ }));
    expect(onSelectNearby).toHaveBeenCalledWith(CHIMNEY);
  });

  it('says nothing of parks for an activity in none, with none of its own', () => {
    render(<ActivityDetail activity={TACOS} onClose={() => {}} />, {
      activities: [TACOS, muirWoods],
    });
    expect(screen.queryByRole('button', { name: /^Part of/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Hikes & stops here|Also in/ }),
    ).not.toBeInTheDocument();
  });

  it('has no siblings to list for a park’s only hike', () => {
    render(<ActivityDetail activity={LIGHTHOUSE} onClose={() => {}} />, {
      activities: [PARK, LIGHTHOUSE],
    });
    expect(screen.getByRole('button', { name: /Part of Test Seashore/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Also in/ })).not.toBeInTheDocument();
  });
});
