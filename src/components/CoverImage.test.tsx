import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CoverImage } from './CoverImage';

describe('CoverImage', () => {
  it('renders the cover image with its alt, classes and loading hint', () => {
    render(
      <CoverImage
        src="https://img.test/a.jpg"
        alt="Muir Woods"
        category="hiking"
        className="h-full w-full object-cover"
        loading="lazy"
      />,
    );
    const img = screen.getByRole('img', { name: 'Muir Woods' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://img.test/a.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveClass('h-full', 'w-full', 'object-cover');
    expect(screen.queryByText('directions_walk')).not.toBeInTheDocument();
  });

  it('swaps to the category glyph when the image fails to load', () => {
    render(
      <CoverImage src="https://img.test/dead.jpg" alt="Muir Woods" category="hiking" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Muir Woods' }));

    const fallback = screen.getByRole('img', { name: 'Muir Woods' });
    expect(fallback.tagName).toBe('DIV');
    expect(fallback).not.toHaveAttribute('src');
    const glyph = screen.getByText('directions_walk');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveStyle({ fontSize: '44px' });
  });

  it('uses the glyph for the activity category at the requested size', () => {
    render(<CoverImage src="" alt="Diner" category="food" glyphSize={64} />);
    expect(screen.getByText('restaurant')).toHaveStyle({ fontSize: '64px' });
  });

  it('falls back immediately when there is no cover', () => {
    const { container } = render(
      <CoverImage src={undefined} alt="Muir Woods" category="hiking" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Muir Woods' }).tagName).toBe('DIV');
    expect(screen.getByText('directions_walk')).toBeInTheDocument();
  });

  it('keeps a decorative (empty-alt) fallback out of the accessibility tree', () => {
    const { container } = render(
      <CoverImage src="https://img.test/dead.jpg" alt="" category="water" />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    const fallback = screen.getByText('water').parentElement as HTMLElement;
    expect(fallback).not.toHaveAttribute('role');
    expect(fallback).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('retries when the src changes after a failure', () => {
    const { container, rerender } = render(
      <CoverImage src="https://img.test/dead.jpg" alt="A" category="scenic" />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();

    rerender(
      <CoverImage src="https://img.test/b.jpg" alt="B" category="scenic" />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://img.test/b.jpg');
    expect(screen.queryByText('landscape')).not.toBeInTheDocument();
  });

  it('does not let an earlier failure hide a later cover that loads', () => {
    const { container, rerender } = render(
      <CoverImage src="https://img.test/dead.jpg" alt="A" category="scenic" />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    rerender(
      <CoverImage src="https://img.test/b.jpg" alt="B" category="scenic" />,
    );
    // The new cover's own failure is tracked against the new URL.
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByRole('img', { name: 'B' }).tagName).toBe('DIV');
  });
});
