import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '../test/render';
import type { Activity } from '../data/types';
import { muirWoods } from '../test/fixtures';
import { PartOfSelect } from './PartOfSelect';

const PARK: Activity = { ...muirWoods, id: 'test-park', name: 'Test Seashore' };
const YOSEMITE: Activity = { ...muirWoods, id: 'test-yosemite', name: 'Test Yosemite' };
const LIGHTHOUSE: Activity = {
  ...muirWoods,
  id: 'test-lighthouse',
  name: 'Test Lighthouse',
  parentId: PARK.id,
};
const ALL = [YOSEMITE, PARK, LIGHTHOUSE, muirWoods];

describe('PartOfSelect (#269)', () => {
  it('offers the parks it could be part of, by name, and shows the one it is', () => {
    render(<PartOfSelect activity={LIGHTHOUSE} className="w-full" onChange={() => {}} />, {
      activities: ALL,
    });
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue(PARK.id);
    expect(select).toHaveClass('w-full');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['— Not part of another —', 'Test Muir Woods', 'Test Seashore', 'Test Yosemite']);
  });

  it('sets a park, or none', async () => {
    const onChange = vi.fn();
    render(<PartOfSelect activity={muirWoods} className="" onChange={onChange} />, {
      activities: ALL,
    });
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('');
    await userEvent.selectOptions(select, 'Test Yosemite');
    expect(onChange).toHaveBeenLastCalledWith(YOSEMITE.id);
    await userEvent.selectOptions(select, '— Not part of another —');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('says why a park with hikes of its own can’t be part of another', () => {
    render(<PartOfSelect activity={PARK} className="" onChange={() => {}} />, { activities: ALL });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByText('It has hikes and stops of its own, so it can’t be part of another.'),
    ).toBeInTheDocument();
  });
});
