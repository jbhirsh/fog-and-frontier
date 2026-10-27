import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { Activity } from '../data/types';
import { muirWoods } from '../test/fixtures';
import { ParkSection } from './ParkSection';

const PARK: Activity = { ...muirWoods, id: 'test-park', name: 'Test Seashore' };

const icon = (name: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('.material-symbols-outlined')).find(
    (el) => el.textContent === name,
  )!;

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

describe('ParkSection, at every width', () => {
  it('names the section by the park alone, reading the whole to a screen reader', () => {
    render(
      <ParkSection park={PARK} gridClass="grid-cols-2" onViewPark={() => {}} onClose={() => {}}>
        <p>a hike</p>
      </ParkSection>,
    );
    const lead = screen.getByText('Hikes & stops in');
    expect(lead).toHaveClass('sr-only');
    expect(lead.className).not.toMatch(/md:/);
    expect(lead.parentElement).toHaveTextContent(/^Hikes & stops in Test Seashore$/);
    expect(screen.getByRole('button', { name: /View park/ })).toHaveClass('whitespace-nowrap');
  });
});
