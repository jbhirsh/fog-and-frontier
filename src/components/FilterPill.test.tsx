import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterPill } from './FilterPill';

describe('FilterPill', () => {
  it('labels its control and boxes both icons at a fixed 18px', () => {
    // The fixed box clips the icon ligature, so a missing icon font (the
    // visual tests stub it) can't widen the chip.
    const { container } = render(
      <FilterPill icon="schedule">
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
});
