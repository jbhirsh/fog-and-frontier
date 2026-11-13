import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FILLED_ICONS, ICONS } from '../lib/iconPaths';
import { Icon } from './Icon';

const path = (el: Element) => el.querySelector('path')?.getAttribute('d');

describe('Icon', () => {
  it('draws its path in a 1em square of the 960-unit box, named for tests', () => {
    const { container } = render(<Icon name="search" />);
    const icon = container.firstElementChild as HTMLElement;
    expect(icon.tagName).toBe('SPAN');
    expect(icon).toHaveAttribute('data-icon', 'search');
    expect(icon).toHaveClass('icon');
    const svg = icon.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 -960 960 960');
    expect(svg).toHaveAttribute('width', '1em');
    expect(svg).toHaveAttribute('height', '1em');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(path(icon)).toBe(ICONS.search);
  });

  it('draws the filled cut when filled, and the outline when not', () => {
    const { container, rerender } = render(<Icon name="star" fill />);
    expect(path(container)).toBe(FILLED_ICONS.star);
    rerender(<Icon name="star" fill={false} />);
    expect(path(container)).toBe(ICONS.star);
    expect(ICONS.star).not.toBe(FILLED_ICONS.star);
  });

  it('keeps the call site’s classes and style beside its own', () => {
    const { container } = render(
      <Icon name="close" className="size-5 text-[20px]" style={{ marginLeft: '-0.2em' }} />,
    );
    const icon = container.firstElementChild as HTMLElement;
    expect(icon).toHaveClass('icon', 'size-5', 'text-[20px]');
    expect(icon.style.marginLeft).toBe('-0.2em');
  });

  it('is hidden from assistive tech unless it says something', () => {
    const { container, rerender } = render(<Icon name="info" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<Icon name="info" label="About the map" />);
    expect(screen.getByRole('img', { name: 'About the map' })).toBe(container.firstElementChild);
    expect(container.firstElementChild).not.toHaveAttribute('aria-hidden');
    // The drawing itself never is: the span speaks for it.
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
