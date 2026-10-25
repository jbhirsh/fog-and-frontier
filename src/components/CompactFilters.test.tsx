import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_FILTERS, type FilterValues } from '../lib/catalogFilterOptions';
import { CompactFilters } from './CompactFilters';

const SOME: FilterValues = {
  ...NO_FILTERS,
  category: 'hiking',
  maxDistance: 25,
  dogOnly: true,
};

/** CompactFilters over live filter state, as the Curated page holds it. */
function Live({ initial = SOME }: { initial?: FilterValues }) {
  const [values, setValues] = useState(initial);
  return (
    <CompactFilters
      values={values}
      onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
      count={3}
      originName="you"
      showFree
      contributorOptions={[]}
    />
  );
}

function chip(label: string) {
  return screen.getByRole('button', { name: `Remove filter: ${label}` });
}

describe('CompactFilters', () => {
  it('is one Filters button when no filter is on', () => {
    render(<Live initial={NO_FILTERS} />);
    // No count in the badge's place, not even a 0.
    expect(screen.getByRole('button', { name: 'Filters' }).textContent).not.toMatch(/\d/);
    expect(screen.queryByRole('list', { name: 'Filters on' })).not.toBeInTheDocument();
  });

  it('counts the filters on, and shows each as a chip', () => {
    render(<Live />);
    expect(screen.getByRole('button', { name: 'Filters, 3 on' })).toHaveTextContent('Filters3');
    expect(chip('Hiking')).toBeInTheDocument();
    expect(chip('Within 25 mi')).toBeInTheDocument();
    expect(chip('Dog friendly')).toBeInTheDocument();
  });

  it('takes a filter off from its chip', async () => {
    const onChange = vi.fn<(patch: Partial<FilterValues>) => void>();
    render(
      <CompactFilters
        values={SOME}
        onChange={onChange}
        count={3}
        originName="you"
        showFree
        contributorOptions={[]}
      />,
    );
    await userEvent.click(chip('Within 25 mi'));
    expect(onChange).toHaveBeenCalledWith({ maxDistance: Infinity });
  });

  it('moves focus to the next chip, then the one before, then the button', async () => {
    render(<Live />);
    await userEvent.click(chip('Within 25 mi'));
    expect(chip('Dog friendly')).toHaveFocus();
    await userEvent.click(chip('Dog friendly'));
    expect(chip('Hiking')).toHaveFocus();
    await userEvent.click(chip('Hiking'));
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
  });

  it('opens the sheet, applies a change at once, and hands focus back on closing', async () => {
    render(<Live initial={NO_FILTERS} />);
    const button = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    const free = screen.getByRole('checkbox', { name: 'Free' });
    await userEvent.click(free);
    expect(chip('Free')).toBeInTheDocument();
    // A new chip behind the sheet leaves focus where it was.
    expect(free).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Show 3 places' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters, 1 on' })).toHaveFocus();
  });

  it('opens the sheet on <body>, out of any frosted box around the button', async () => {
    render(
      <div data-testid="toolbar">
        <Live initial={NO_FILTERS} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(screen.getByTestId('toolbar')).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });
});
