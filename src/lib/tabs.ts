// Where the phone's tab bar (#289) goes, and which tab a page is under.

/** The catalog's address with `view` set to `view`, or dropped for the list, keeping its other params (search, filters). */
export function catalogHref(params: URLSearchParams, view: 'map' | null): string {
  const next = new URLSearchParams(params);
  if (view) next.set('view', view);
  else next.delete('view');
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

/** Which tab a page belongs to. */
export function currentTab(pathname: string, view: string | null): string | null {
  if (pathname === '/') return view === 'map' ? 'map' : 'places';
  if (pathname.startsWith('/trips')) return 'trips';
  if (pathname.startsWith('/explore')) return 'explore';
  return null;
}
