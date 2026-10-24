import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { Activity } from '../data/types';
import { muirWoods } from '../test/fixtures';
import { ParkActivities, PartOfPark } from './ParkLinks';

const PARK: Activity = { ...muirWoods, id: 'test-park', name: 'Test Seashore' };
const LIGHTHOUSE: Activity = {
  ...muirWoods,
  id: 'test-lighthouse',
  name: 'Test Lighthouse',
  category: 'scenic',
  duration: 'Full Day',
};

describe('PartOfPark (#269)', () => {
  it('names the park, and opens it', async () => {
    const onSelect = vi.fn();
    render(<PartOfPark park={PARK} onSelect={onSelect} />);
    const link = screen.getByRole('button', { name: /Part of Test Seashore/ });
    const chevron = within(link).getByText('chevron_right');
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(chevron.style.fontSize).toBe('18px');
    await userEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith(PARK);
  });
});

describe('ParkActivities (#269)', () => {
  it('lists each under its heading with its category and how long it takes', async () => {
    const onSelect = vi.fn();
    render(
      <ParkActivities heading="Hikes & stops here" activities={[LIGHTHOUSE]} onSelect={onSelect} />,
    );
    expect(screen.getByRole('heading', { name: 'Hikes & stops here' })).toBeInTheDocument();
    const tile = screen.getByRole('button', { name: /Test Lighthouse/ });
    expect(within(tile).getByText('Scenic')).toBeInTheDocument();
    expect(within(tile).getByText('Full Day')).toBeInTheDocument();
    await userEvent.click(tile);
    expect(onSelect).toHaveBeenCalledWith(LIGHTHOUSE);
  });
});
