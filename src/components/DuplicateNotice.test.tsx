import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuplicateNotice } from './DuplicateNotice';
import type { DuplicateMatch } from '../lib/duplicates';

const high: DuplicateMatch = {
  id: 'castle',
  name: 'Castle Rock',
  city: 'Los Gatos',
  distanceMeters: 30,
  confidence: 'high',
};
const possible: DuplicateMatch = {
  ...high,
  id: 'castle-park',
  name: 'Castle Rock Park',
  confidence: 'possible',
};

describe('DuplicateNotice (#17)', () => {
  it('renders nothing without a match', () => {
    const { container } = render(
      <DuplicateNotice matches={[]} onSaveAnyway={() => {}} saving={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('holds a high match: open the saved one, or save anyway', async () => {
    const onOpenActivity = vi.fn();
    const onSaveAnyway = vi.fn();
    render(
      <DuplicateNotice
        matches={[high, possible]}
        onOpenActivity={onOpenActivity}
        onSaveAnyway={onSaveAnyway}
        saving={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This looks like a duplicate of Castle Rock in Los Gatos.',
    );
    const open = screen.getByRole('button', { name: 'Open existing' });
    expect(open).toHaveAccessibleDescription(
      'This looks like a duplicate of Castle Rock in Los Gatos.',
    );
    expect(screen.getByRole('button', { name: 'Save anyway' })).toHaveAccessibleDescription(
      'This looks like a duplicate of Castle Rock in Los Gatos.',
    );
    await userEvent.click(open);
    expect(onOpenActivity).toHaveBeenCalledWith('castle');
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
  });

  it("can't save anyway twice while a save is going, and names without a way to open", () => {
    render(<DuplicateNotice matches={[high]} onSaveAnyway={() => {}} saving />);
    expect(screen.getByRole('button', { name: 'Save anyway' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Open existing' })).not.toBeInTheDocument();
  });

  it('names the go-ahead for what it does: a suggestion is sent (#73)', () => {
    render(
      <DuplicateNotice
        matches={[high]}
        onSaveAnyway={() => {}}
        saving={false}
        anywayLabel="Send anyway"
      />,
    );
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save anyway' })).not.toBeInTheDocument();
  });

  it('only notes a possible match, with a way to view it', async () => {
    const onOpenActivity = vi.fn();
    render(
      <DuplicateNotice
        matches={[possible]}
        onOpenActivity={onOpenActivity}
        onSaveAnyway={() => {}}
        saving={false}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'You may already have Castle Rock Park in Los Gatos saved.',
    );
    expect(screen.queryByRole('button', { name: 'Save anyway' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toHaveAccessibleDescription(
      'You may already have Castle Rock Park in Los Gatos saved.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onOpenActivity).toHaveBeenCalledWith('castle-park');
  });
});
