import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { muirWoods } from './test/fixtures';

vi.mock('./data/activities', () => ({ activities: [muirWoods] }));

import App from './App';

describe('App', () => {
  it('renders Curated Adventures at the root route', () => {
    render(<App />);
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });
});
