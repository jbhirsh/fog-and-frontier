import { describe, expect, it } from 'vitest';
import { catalogHref, currentTab } from './tabs';

describe('catalogHref', () => {
  it('sets or drops the view, keeping the search and filters', () => {
    const params = new URLSearchParams('q=redwood&completed=1&view=map');
    expect(catalogHref(params, null)).toBe('/?q=redwood&completed=1');
    expect(catalogHref(params, 'map')).toBe('/?q=redwood&completed=1&view=map');
  });

  it('is the bare catalog with nothing to keep', () => {
    expect(catalogHref(new URLSearchParams(), null)).toBe('/');
    expect(catalogHref(new URLSearchParams('view=list'), null)).toBe('/');
    expect(catalogHref(new URLSearchParams(), 'map')).toBe('/?view=map');
  });

  it('leaves the params it was given alone', () => {
    const params = new URLSearchParams('view=map');
    catalogHref(params, null);
    expect(params.get('view')).toBe('map');
  });
});

describe('currentTab', () => {
  it('names the tab each page is under', () => {
    expect(currentTab('/', null)).toBe('places');
    expect(currentTab('/', 'list')).toBe('places');
    expect(currentTab('/', 'map')).toBe('map');
    expect(currentTab('/trips', null)).toBe('trips');
    expect(currentTab('/trips/abc', null)).toBe('trips');
    expect(currentTab('/explore', null)).toBe('explore');
    expect(currentTab('/share', null)).toBeNull();
    expect(currentTab('/activity/x', 'map')).toBeNull();
  });
});
