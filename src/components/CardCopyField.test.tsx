import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardCopyField } from './CardCopyField';

function Live({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <CardCopyField
      label="Card line"
      hint="Shown whole."
      value={value}
      max={10}
      onChange={setValue}
      className="w-full"
    />
  );
}

describe('CardCopyField', () => {
  it('is a named field described by its hint and its count', () => {
    render(<Live initial="Lands End" />);
    const field = screen.getByLabelText('Card line');
    expect(field).toHaveValue('Lands End');
    expect(field).toHaveClass('w-full');
    expect(field).toHaveAccessibleDescription('Shown whole. 9/10');
    expect(field).toHaveAttribute('aria-invalid', 'false');
    // Read with the field, not announced on every keystroke.
    expect(screen.getByText('9/10')).not.toHaveAttribute('aria-live');
  });

  it('counts as it’s typed, trimmed, and turns red past the cap', async () => {
    render(<Live />);
    const field = screen.getByLabelText('Card line');
    await userEvent.type(field, ' Golden ');
    expect(screen.getByText('6/10')).not.toHaveClass('text-error');
    await userEvent.type(field, 'Gate Park');
    const count = screen.getByText('16/10');
    expect(count).toHaveClass('text-error');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('counts an emoji as one', () => {
    render(<Live initial="🐕🐕" />);
    expect(screen.getByText('2/10')).toBeInTheDocument();
  });
});
