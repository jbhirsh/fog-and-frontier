import { describe, expect, it } from 'vitest';
import { render, screen } from './test/render';
import { muirWoods } from './test/fixtures';

import App from './App';

describe('App', () => {
  it('renders Curated Adventures at the root route', () => {
    render(<App />, { activities: [muirWoods] });
    expect(screen.getByText('Curated Adventures')).toBeInTheDocument();
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
  });
});
