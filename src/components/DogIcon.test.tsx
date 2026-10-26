import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DogIcon } from './DogIcon';

describe('DogIcon', () => {
  it('draws the dog’s head in the text color, hidden from screen readers', () => {
    const { container } = render(<DogIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '1.7');
  });

  it('takes a size and a stroke', () => {
    const { container } = render(<DogIcon size={28} strokeWidth={1.4} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('height', '28');
    expect(svg).toHaveAttribute('stroke-width', '1.4');
  });
});
