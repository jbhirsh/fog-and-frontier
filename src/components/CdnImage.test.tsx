import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CdnImage } from './CdnImage';
import { cdnUrl } from '../lib/imageCdn';

const PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Santa_Clara_Central_Park_Library.jpg';
const OTHER = 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Los_Gatos_Creek_Trail.jpg';

describe('CdnImage', () => {
  it('asks the CDN, offering every width at the size it’s shown', () => {
    render(<CdnImage cdn src={PHOTO} alt="Library" sizes="96px" className="w-full" loading="lazy" />);
    const img = screen.getByRole('img', { name: 'Library' });
    expect(img).toHaveAttribute('src', cdnUrl(PHOTO, 960));
    expect(img.getAttribute('srcset')).toContain(`${cdnUrl(PHOTO, 96)} 96w`);
    expect(img).toHaveAttribute('sizes', '96px');
    // Everything else passes through.
    expect(img).toHaveClass('w-full');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to the photo’s own URL if the CDN fails, then to the caller', () => {
    const onFailed = vi.fn();
    render(<CdnImage cdn src={PHOTO} alt="Library" sizes="96px" onFailed={onFailed} />);
    const img = screen.getByRole('img', { name: 'Library' });
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', PHOTO);
    expect(img).not.toHaveAttribute('srcset');
    expect(img).not.toHaveAttribute('sizes');
    expect(onFailed).not.toHaveBeenCalled();
    fireEvent.error(img);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('gives a new photo the CDN again', () => {
    const { rerender } = render(<CdnImage cdn src={PHOTO} alt="" sizes="96px" />);
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('img')).toHaveAttribute('src', PHOTO);
    rerender(<CdnImage cdn src={OTHER} alt="" sizes="96px" />);
    expect(document.querySelector('img')).toHaveAttribute('src', cdnUrl(OTHER, 960));
  });

  it('uses the photo’s own URL off Vercel, and tells the caller when that fails', () => {
    const onFailed = vi.fn();
    render(<CdnImage src={PHOTO} alt="Library" sizes="96px" onFailed={onFailed} />);
    const img = screen.getByRole('img', { name: 'Library' });
    expect(img).toHaveAttribute('src', PHOTO);
    expect(img).not.toHaveAttribute('srcset');
    expect(img).not.toHaveAttribute('sizes');
    fireEvent.error(img);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('gives an address that isn’t a web one no source at all', () => {
    const onFailed = vi.fn();
    render(<CdnImage cdn src="javascript:alert(1)" alt="Library" sizes="96px" onFailed={onFailed} />);
    const img = screen.getByRole('img', { name: 'Library' });
    expect(img).not.toHaveAttribute('src');
    expect(img).not.toHaveAttribute('srcset');
    expect(img).not.toHaveAttribute('sizes');
    // An error then goes to the caller, not to a retry.
    fireEvent.error(img);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('percent-encodes " < and > in the address it’s given', () => {
    render(<CdnImage src={'https://img.example/a"<b>.jpg'} alt="Library" sizes="96px" />);
    expect(screen.getByRole('img', { name: 'Library' })).toHaveAttribute(
      'src',
      'https://img.example/a%22%3Cb%3E.jpg',
    );
  });

  it('shows an inline image as it is', () => {
    render(<CdnImage cdn src="data:image/png;base64,AAAA" alt="Library" sizes="96px" />);
    expect(screen.getByRole('img', { name: 'Library' })).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  it('copes with no fallback of the caller’s', () => {
    render(<CdnImage src={PHOTO} alt="Library" sizes="96px" />);
    expect(() => fireEvent.error(screen.getByRole('img', { name: 'Library' }))).not.toThrow();
  });
});
