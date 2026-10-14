import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAddPicker } from './useAddPicker';

function Picker({ onAdd }: { onAdd: (v: string) => void }) {
  const picker = useAddPicker(onAdd);
  return (
    <select aria-label="Add" {...picker}>
      <option value="" disabled>
        Add
      </option>
      <option value="a">A</option>
      <option value="b">B</option>
    </select>
  );
}

function setup() {
  const onAdd = vi.fn();
  render(<Picker onAdd={onAdd} />);
  return { onAdd, select: screen.getByRole<HTMLSelectElement>('combobox', { name: 'Add' }) };
}

describe('useAddPicker (#9)', () => {
  it('adds a pick made without the keyboard at once, and resets', () => {
    const { onAdd, select } = setup();
    fireEvent.change(select, { target: { value: 'a' } });
    expect(onAdd).toHaveBeenCalledWith('a');
    expect(select.value).toBe('');
  });

  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'b'])(
    'only moves the selection on %s, then Enter adds it',
    (key) => {
      const { onAdd, select } = setup();
      fireEvent.keyDown(select, { key });
      fireEvent.change(select, { target: { value: 'b' } });
      expect(onAdd).not.toHaveBeenCalled();
      expect(select.value).toBe('b');
      const enter = fireEvent.keyDown(select, { key: 'Enter' });
      expect(enter).toBe(false); // default prevented
      expect(onAdd).toHaveBeenCalledWith('b');
      expect(select.value).toBe('');
    },
  );

  it('keeps browsing past the first name, adding none of them', () => {
    const { onAdd, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'a' } });
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('adds what was browsed to when focus leaves', () => {
    const { onAdd, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'a' } });
    fireEvent.blur(select);
    expect(onAdd).toHaveBeenCalledWith('a');
    expect(select.value).toBe('');
  });

  it('forgets the browsing on blur, so the next pick by mouse adds', () => {
    const { onAdd, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.blur(select);
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onAdd).toHaveBeenCalledWith('b');
  });

  it('adds nothing on Enter or blur with nothing browsed to', () => {
    const { onAdd, select } = setup();
    expect(fireEvent.keyDown(select, { key: 'Enter' })).toBe(true);
    fireEvent.blur(select);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it.each([
    ['Space', { key: ' ' }],
    ['Alt+Down', { key: 'ArrowDown', altKey: true }],
    ['Tab', { key: 'Tab' }],
  ])('treats a pick after %s (which opens the list) as a pick', (_label, init) => {
    const { onAdd, select } = setup();
    fireEvent.keyDown(select, init);
    fireEvent.change(select, { target: { value: 'a' } });
    expect(onAdd).toHaveBeenCalledWith('a');
  });

  it('counts each browse once: a later pick by mouse adds', () => {
    const { onAdd, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'a' } });
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onAdd).toHaveBeenCalledWith('b');
  });
});
