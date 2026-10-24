import { beforeAll, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { RegionOption } from '../lib/regions';

// The region list held back, to see the field before it arrives or when it
// can't.
let settle: { resolve: (o: RegionOption[]) => void; reject: (e: Error) => void } | undefined;
vi.mock('../lib/regions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/regions')>();
  return {
    ...actual,
    loadRegionOptions: () =>
      new Promise<RegionOption[]>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  };
});

import { RegionPicker } from './RegionPicker';

// The region list scrolls its option into view (#274), which jsdom doesn't do.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const field = () => screen.getByRole('combobox', { name: 'Region' });
const shown = () =>
  within(screen.getByRole('listbox'))
    .queryAllByRole('option')
    .map((o) => o.textContent);

describe('RegionPicker before the full list (#274)', () => {
  it('offers California’s areas, says it’s loading the rest, then offers them', async () => {
    render(<RegionPicker label="Region" value="" onChange={() => {}} className="w-full" />);
    await userEvent.click(field());
    expect(shown()).toHaveLength(8);
    await userEvent.type(field(), 'kyo');
    expect(shown()).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading regions…');
    settle?.resolve([{ id: 'JP-26', label: 'Kyoto, Japan', key: 'kyoto japan jp 26' }]);
    await waitFor(() => expect(shown()).toEqual(['Kyoto, Japan']));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('still offers California’s areas when the rest can’t load, and says so', async () => {
    render(<RegionPicker label="Region" value="" onChange={() => {}} className="w-full" />);
    settle?.reject(new Error('chunk gone'));
    await userEvent.click(field());
    expect(shown()).toHaveLength(8);
    await userEvent.type(field(), 'kyo');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        "Couldn't load every region: reopen this form to try again",
      ),
    );
  });
});
