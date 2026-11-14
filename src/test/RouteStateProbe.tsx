import { useLocation, useNavigationType, type Location } from 'react-router-dom';

// Mounted at a route a component navigates to, or beside it: shows the path,
// query and router state it was handed (`route-state`), and how the last
// navigation changed history (`route-navigation`: PUSH, REPLACE, or POP for
// the first entry), so a test can read what the navigation carried.
export function RouteStateProbe() {
  const location: Location<unknown> = useLocation();
  return (
    <>
      <div data-testid="route-state">
        {`${location.pathname}${location.search} ${JSON.stringify(location.state)}`}
      </div>
      <div data-testid="route-navigation">{useNavigationType()}</div>
    </>
  );
}
