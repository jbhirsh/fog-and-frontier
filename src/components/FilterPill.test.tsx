import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterPill } from './FilterPill';

describe('FilterPill', () => {
  it('labels its control and boxes both icons at a fixed 18px', () => {
    // The fixed box clips the icon ligature, so a missing icon font (the
    // visual tests stub it) can't widen the chip.
    const { container } = render(
      <FilterPill icon="schedule" label="Any">
        <select aria-label="Duration">
          <option>Any</option>
        </select>
      </FilterPill>,
    );
    expect(screen.getByRole('combobox', { name: 'Duration' }).closest('label')).not.toBeNull();
    const icons = [...container.querySelectorAll<HTMLElement>('.material-symbols-outlined')];
    expect(icons.map((i) => i.textContent)).toEqual(['schedule', 'expand_more']);
    for (const icon of icons) {
      expect(icon.style).toMatchObject({ fontSize: '18px', width: '18px', height: '18px' });
    }
  });

  it('shows the chosen label and lays the select over the whole chip', () => {
    // A select is as wide as its longest option; the chip sizes to its label.
    render(
      <FilterPill icon="location_on" label="Any distance">
        <select aria-label="Distance">
          <option>Any distance</option>
          <option>Within 100 mi of San Jose, CA</option>
        </select>
      </FilterPill>,
    );
    // The select names itself; the visible label, which repeats its choice,
    // is hidden from assistive tech so it isn't read twice.
    const select = screen.getByRole('combobox', { name: 'Distance' });
    expect(select.parentElement).toHaveClass('absolute', 'inset-0');
    expect(screen.getByText('Any distance', { selector: 'span' })).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
