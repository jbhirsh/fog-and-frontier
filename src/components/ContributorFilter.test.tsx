import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContributorFilter } from './ContributorFilter';

const TARUN = 'tarun@example.com';
const JESS = 'jess.hirsh@example.com';
const SAM = 'sam@example.com';

describe('ContributorFilter (#9)', () => {
  it('renders nothing when no one is credited', () => {
    const { container } = render(
      <ContributorFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers everyone by name, and adds the one picked', async () => {
    const onChange = vi.fn();
    render(<ContributorFilter options={[JESS, TARUN]} selected={[]} onChange={onChange} />);
    const picker = screen.getByRole('combobox', { name: 'Contributed by' });
    expect(screen.getByRole('option', { name: 'Any contributor' })).toBeDisabled();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Any contributor',
      'Jess Hirsh',
      'Tarun',
    ]);
    await userEvent.selectOptions(picker, TARUN);
    expect(onChange).toHaveBeenCalledWith([TARUN]);
  });

  it('shows a chip per chosen account, offers only the rest, and adds to the list', async () => {
    const onChange = vi.fn();
    render(<ContributorFilter options={[JESS, TARUN]} selected={[TARUN]} onChange={onChange} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Add contributor',
      'Jess Hirsh',
    ]);
    await userEvent.selectOptions(screen.getByRole('combobox'), JESS);
    expect(onChange).toHaveBeenCalledWith([TARUN, JESS]);
  });

  it('labels its pill "Any contributor", then "Add contributor" once one is chosen', () => {
    // The pill shows its own label over the invisible select (FilterPill).
    // Read that label alone: the select's placeholder option holds the same
    // words, so the whole pill's text would match without it.
    const shown = () =>
      screen
        .getByRole('combobox', { name: 'Contributed by' })
        .closest('label')
        ?.querySelector('span[aria-hidden="true"].whitespace-nowrap')?.textContent;
    const { rerender } = render(
      <ContributorFilter options={[JESS, TARUN]} selected={[]} onChange={() => {}} />,
    );
    expect(shown()).toBe('Any contributor');
    rerender(<ContributorFilter options={[JESS, TARUN]} selected={[TARUN]} onChange={() => {}} />);
    expect(shown()).toBe('Add contributor');
  });

  it("pulls a chip's edge icons out by their glyphs' empty sides", () => {
    render(<ContributorFilter options={[JESS, TARUN]} selected={[TARUN]} onChange={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Remove contributor filter: Tarun' });
    const [person, close] = [...chip.querySelectorAll<HTMLElement>('.material-symbols-outlined')];
    expect(person).toHaveTextContent('person');
    expect(person.style.marginLeft).toBe('-0.167em');
    expect(close).toHaveTextContent('close');
    expect(close.style.marginRight).toBe('-0.194em');
  });

  it('takes a chosen account off with its chip', async () => {
    const onChange = vi.fn();
    render(
      <ContributorFilter options={[JESS, TARUN]} selected={[TARUN, JESS]} onChange={onChange} />,
    );
    // Everyone is chosen, so there's no one left to pick.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove contributor filter: Tarun' }));
    expect(onChange).toHaveBeenCalledWith([JESS]);
  });

  it('boxes the chip icons at a fixed 18px', () => {
    render(<ContributorFilter options={[TARUN]} selected={[TARUN]} onChange={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Remove contributor filter: Tarun' });
    const icons = [...chip.querySelectorAll<HTMLElement>('.material-symbols-outlined')];
    expect(icons.map((i) => i.textContent)).toEqual(['person', 'close']);
    for (const icon of icons) {
      expect(icon.style).toMatchObject({ fontSize: '18px', width: '18px', height: '18px' });
    }
  });

  describe('focus, when the control it was on goes away', () => {
    function Stateful({ initial }: { initial: string[] }) {
      const [selected, setSelected] = useState(initial);
      return (
        <ContributorFilter
          options={[JESS, TARUN, SAM]}
          selected={selected}
          onChange={setSelected}
        />
      );
    }
    const remove = (name: string) =>
      screen.getByRole('button', { name: `Remove contributor filter: ${name}` });

    it('moves to the next chip, else the one before, else the picker', async () => {
      render(<Stateful initial={[TARUN, JESS, SAM]} />);
      await userEvent.click(remove('Jess Hirsh'));
      expect(remove('Sam')).toHaveFocus();
      await userEvent.click(remove('Sam'));
      expect(remove('Tarun')).toHaveFocus();
      await userEvent.click(remove('Tarun'));
      expect(screen.getByRole('combobox', { name: 'Contributed by' })).toHaveFocus();
    });

    it('moves to the new chip when the last name is picked', async () => {
      render(<Stateful initial={[TARUN, JESS]} />);
      await userEvent.selectOptions(screen.getByRole('combobox'), SAM);
      expect(remove('Sam')).toHaveFocus();
    });

    it('leaves focus where it went when a browsed-to last name is added on leaving', async () => {
      render(
        <>
          <Stateful initial={[TARUN, JESS]} />
          <button type="button">Next thing</button>
        </>,
      );
      const picker = screen.getByRole('combobox');
      picker.focus();
      fireEvent.keyDown(picker, { key: 'ArrowDown' });
      fireEvent.change(picker, { target: { value: SAM } });
      await userEvent.tab();
      expect(remove('Sam')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next thing' })).toHaveFocus();
    });

    it('takes no focus on the first render, or for a change it did not make', () => {
      const { rerender } = render(
        <ContributorFilter options={[JESS, TARUN]} selected={[TARUN]} onChange={() => {}} />,
      );
      expect(document.body).toHaveFocus();
      rerender(<ContributorFilter options={[JESS, TARUN]} selected={[]} onChange={() => {}} />);
      expect(document.body).toHaveFocus();
    });

    it('stays on the picker while it has names left', async () => {
      render(<Stateful initial={[]} />);
      const picker = screen.getByRole('combobox');
      picker.focus();
      await userEvent.selectOptions(picker, SAM);
      expect(picker).toHaveFocus();
    });
  });
});
