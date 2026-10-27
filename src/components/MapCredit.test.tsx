import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapCredit } from './MapCredit';

describe('MapCredit', () => {
  it('shows only its ⓘ until it’s opened', () => {
    render(<MapCredit />);
    const button = screen.getByRole('button', { name: 'Map credits' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Leaflet/)).not.toBeInTheDocument();
  });

  it('opens the tiles’ credit, linking both, and closes it again', async () => {
    render(<MapCredit />);
    const button = screen.getByRole('button', { name: 'Map credits' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const credit = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(credit).toHaveTextContent('© OpenStreetMap contributors © CARTO');
    const osm = screen.getByRole('link', { name: 'OpenStreetMap' });
    expect(osm).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(osm).toHaveAttribute('target', '_blank');
    expect(osm).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'CARTO' })).toHaveAttribute(
      'href',
      'https://carto.com/attributions',
    );
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sits in the corner, as far up as it’s told', () => {
    const { container, rerender } = render(<MapCredit />);
    const box = container.firstElementChild;
    expect(box).toHaveClass('absolute', 'right-2');
    if (!(box instanceof HTMLElement)) throw new Error('no box');
    expect(box.style.bottom).toBe('8px');
    rerender(<MapCredit bottom="5rem" />);
    expect(box.style.bottom).toBe('5rem');
  });
});
