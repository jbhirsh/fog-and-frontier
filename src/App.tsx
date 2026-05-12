import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Layout } from './components/Layout';
import { CuratedAdventures } from './pages/CuratedAdventures';
import { Explore } from './pages/Explore';
import { Adventures } from './pages/Adventures';
import { Map } from './pages/Map';

// Speed Insights' `route` prop is only auto-set for Next/Nuxt/SvelteKit/Remix.
// In our Vite + react-router SPA we feed it the current pathname so each route
// reports as a distinct page instead of collapsing under "/".
function RouteAwareSpeedInsights() {
  const location = useLocation();
  return <SpeedInsights route={location.pathname} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteAwareSpeedInsights />
      <Routes>
        {/* Clerk OAuth (e.g., "Sign in with Google") sends the browser to
            <site>/sso-callback after the identity provider hands control back
            to Clerk. This route lets Clerk finish the handshake and then
            navigate the user back to where they started. Must be outside
            Layout so the chrome doesn't flash. */}
        <Route
          path="/sso-callback"
          element={<AuthenticateWithRedirectCallback />}
        />
        <Route element={<Layout />}>
          <Route path="/" element={<CuratedAdventures />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/adventures" element={<Adventures />} />
          <Route path="/map" element={<Map />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
