import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TripCardBody } from './TripCardBody';

const PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Los_Gatos_Creek_Trail.jpg';

describe('TripCardBody', () => {
  it('shows the cover, name and city', () => {
    const { container } = render(
      <TripCardBody cover={PHOTO} name="Creek Trail" cityLine="Campbell" orphaned={false} />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', PHOTO);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('size-full', 'object-cover');
    expect(screen.getByText('Creek Trail')).toBeInTheDocument();
    expect(screen.getByText('Campbell')).toBeInTheDocument();
    expect(screen.queryByText('landscape')).not.toBeInTheDocument();
    expect(screen.queryByText('Original activity was deleted.')).not.toBeInTheDocument();
  });

  it('shows the landscape glyph without a cover, and no city line without a city', () => {
    const { container } = render(
      <TripCardBody cover={null} name="Creek Trail" cityLine="" orphaned={false} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('landscape')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('Creek Trail').parentElement?.children).toHaveLength(1);
  });

  it('says when the activity behind it was deleted', () => {
    render(<TripCardBody cover={null} name="Gone" cityLine="" orphaned />);
    expect(screen.getByText('Original activity was deleted.')).toHaveClass('text-error');
  });

  it('keeps the name and city to one line unless asked to wrap', () => {
    render(<TripCardBody cover={null} name="Creek Trail" cityLine="Campbell" orphaned={false} />);
    for (const text of ['Creek Trail', 'Campbell']) {
      expect(screen.getByText(text)).toHaveClass('line-clamp-1');
      expect(screen.getByText(text)).not.toHaveClass('wrap-break-word');
    }
  });

  it('wraps the name and city on a phone, one line from md, when asked', () => {
    render(
      <TripCardBody cover={null} name="Creek Trail" cityLine="Campbell" orphaned={false} wrap />,
    );
    for (const text of ['Creek Trail', 'Campbell']) {
      expect(screen.getByText(text)).toHaveClass('wrap-break-word', 'md:line-clamp-1');
      expect(screen.getByText(text)).not.toHaveClass('line-clamp-1');
    }
  });
});
