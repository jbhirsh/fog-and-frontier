import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewModeToggle, type ViewMode } from './ViewModeToggle';

describe('ViewModeToggle', () => {
  it('renders the three options as a radiogroup', () => {
    render(<ViewModeToggle value="split" onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'View mode' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Split' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Map' })).toBeInTheDocument();
  });

  it('aria-checked reflects the value prop', () => {
    const { rerender } = render(
      <ViewModeToggle value="list" onChange={() => {}} />,
    );
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Split' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    rerender(<ViewModeToggle value="map" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('only the selected segment is in the tab order (roving tabindex)', () => {
    render(<ViewModeToggle value="split" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Split' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('calls onChange with the clicked mode', async () => {
    const onChange = vi.fn<(m: ViewMode) => void>();
    render(<ViewModeToggle value="list" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Map' }));
    expect(onChange).toHaveBeenCalledWith('map');
  });

  it('ArrowRight selects the next segment', async () => {
    const onChange = vi.fn<(m: ViewMode) => void>();
    render(<ViewModeToggle value="list" onChange={onChange} />);
    screen.getByRole('radio', { name: 'List' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('split');
  });

  it('ArrowLeft selects the previous segment', async () => {
    const onChange = vi.fn<(m: ViewMode) => void>();
    render(<ViewModeToggle value="split" onChange={onChange} />);
    screen.getByRole('radio', { name: 'Split' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('ArrowRight wraps from the last segment to the first', async () => {
    const onChange = vi.fn<(m: ViewMode) => void>();
    render(<ViewModeToggle value="map" onChange={onChange} />);
    screen.getByRole('radio', { name: 'Map' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('ArrowLeft wraps from the first segment to the last', async () => {
    const onChange = vi.fn<(m: ViewMode) => void>();
    render(<ViewModeToggle value="list" onChange={onChange} />);
    screen.getByRole('radio', { name: 'List' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('map');
  });

  it('Home and End jump to the first and last segments', async () => {
    const onChange = vi.fn<(m: ViewMode) => void>();
    render(<ViewModeToggle value="split" onChange={onChange} />);
    screen.getByRole('radio', { name: 'Split' }).focus();
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('list');
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('map');
  });
});
