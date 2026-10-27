import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { Activity } from '../data/types';
import { glyphBleed } from '../lib/iconMetrics';
import { muirWoods } from '../test/fixtures';
import { ParkBar, ParkSection } from './ParkSection';

const PARK: Activity = { ...muirWoods, id: 'test-park', name: 'Test Seashore' };

const icon = (name: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('.material-symbols-outlined')).find(
    (el) => el.textContent === name,
  )!;

describe('ParkBar (#269)', () => {
  it('counts the park’s hikes and stops, and opens them', async () => {
    const onToggle = vi.fn();
    render(<ParkBar park={PARK} count={6} open={false} onToggle={onToggle} />);
    const bar = screen.getByRole('button', { name: '6 hikes & stops in Test Seashore' });
    expect(bar).toHaveTextContent('6 hikes & stops');
    expect(bar).toHaveAttribute('id', 'park-bar-test-park');
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    expect(bar).not.toHaveAttribute('aria-controls');
    expect(icon('account_tree').style).toMatchObject({
      fontSize: '18px',
      marginLeft: `${glyphBleed('account_tree')}px`,
    });
    expect(icon('expand_more').style.fontSize).toBe('22px');
    await userEvent.click(bar);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('says it’s open, and which section it controls', () => {
    render(<ParkBar park={PARK} count={1} open onToggle={() => {}} />);
    const bar = screen.getByRole('button', { name: '1 hike or stop in Test Seashore' });
    expect(bar).toHaveAttribute('aria-expanded', 'true');
    expect(bar).toHaveAttribute('aria-controls', 'park-test-park');
    expect(icon('expand_less')).toBeInTheDocument();
  });
});

describe('ParkSection (#269)', () => {
  it('holds the park’s cards under its heading, with a way to the park and out', async () => {
    const onViewPark = vi.fn();
    const onClose = vi.fn();
    render(
      <ParkSection park={PARK} gridClass="grid-cols-4" onViewPark={onViewPark} onClose={onClose}>
        <p>a hike</p>
      </ParkSection>,
    );
    const section = screen.getByRole('region', { name: 'Hikes & stops in Test Seashore' });
    expect(section).toHaveAttribute('id', 'park-test-park');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('a hike').parentElement).toHaveClass('grid', 'grid-cols-4');
    expect(icon('arrow_forward').style.fontSize).toBe('18px');
    expect(icon('close').style.fontSize).toBe('22px');

    await userEvent.click(screen.getByRole('button', { name: /View park/ }));
    expect(onViewPark).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole('button', { name: "Close Test Seashore's hikes and stops" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ParkBar and ParkSection, by screen size', () => {
  it('is a bar under the card, drawn only from md up', () => {
    const { rerender } = render(<ParkBar park={PARK} count={4} open={false} onToggle={() => {}} />);
    const bar = screen.getByRole('button', { name: '4 hikes & stops in Test Seashore' });
    expect(bar).toHaveClass('min-h-11', 'border', 'bg-surface-container-low');
    expect(icon('account_tree')).not.toHaveClass('hidden');
    rerender(<ParkBar park={PARK} count={4} open onToggle={() => {}} />);
    expect(bar).toHaveClass('border-primary', 'bg-primary-fixed');
  });

  it('names the section by the park alone, reading the whole to a screen reader', () => {
    render(
      <ParkSection park={PARK} gridClass="grid-cols-2" onViewPark={() => {}} onClose={() => {}}>
        <p>a hike</p>
      </ParkSection>,
    );
    const lead = screen.getByText('Hikes & stops in');
    expect(lead).toHaveClass('sr-only', 'md:not-sr-only');
    expect(lead.parentElement).toHaveTextContent(/^Hikes & stops in Test Seashore$/);
    expect(screen.getByRole('button', { name: /View park/ })).toHaveClass('whitespace-nowrap');
  });
});
