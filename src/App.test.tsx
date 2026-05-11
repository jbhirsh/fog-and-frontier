import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { muirWoods, seedActivities } from './test/fixtures';

import App from './App';

describe('App', () => {
  beforeEach(() => {
    seedActivities([muirWoods]);
  });

  it('renders Curated Adventures at the root route', () => {
    render(<App />);
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });
});
