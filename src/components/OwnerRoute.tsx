import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useOwner } from '../lib/useOwner';

// Route guard for owner-only surfaces (#111). Renders nothing until auth has
// loaded: an owner hard-refreshing the page would otherwise be bounced to "/"
// before Clerk reports who they are. Non-owners are redirected home.
//
// UI hint only — requireOwnerCtx (api/_gqlContext.ts) still gates the
// owner-only calls these surfaces make.
export function OwnerRoute({ children }: { children: ReactNode }) {
  const { isOwner, isLoaded } = useOwner();
  if (!isLoaded) return null;
  if (!isOwner) return <Navigate to="/" replace />;
  return children;
}
