import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { muirWoods } from './test/fixtures';

vi.mock('./data/activities', () => ({ activities: [muirWoods] }));

import App from './App';

describe('App', () => {
  it('renders the Explore page at the root route', () => {
    render(<App />);
    expect(screen.getByText('Discover the Coast')).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });
});
