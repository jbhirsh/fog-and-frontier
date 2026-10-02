import { useAuthState } from './authShim';

// A blank or trailing-comma list leaves an '' entry; it can never match,
// because useOwner only looks up a non-empty email.
const ownerEmails = new Set(
  ((import.meta.env.VITE_OWNER_EMAILS as string | undefined) ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase()),
);

// UI hint only — server-side requireOwnerCtx (api/_gqlContext.ts) is the
// actual gate.
export function useOwner(): {
  isOwner: boolean;
  isLoaded: boolean;
  email: string | null;
} {
  const { isLoaded, email } = useAuthState();
  const lower = email?.trim().toLowerCase() ?? null;
  // Dev/test-only escape hatch so Playwright can exercise owner-gated UI
  // without a real Clerk session. Production strictly ignores the flag —
  // the env-mode check is evaluated at build time, so a hostile script in
  // prod can never flip owner status by setting window.__TEST_FORCE_OWNER__.
  const forceOwner =
    (import.meta.env.DEV || import.meta.env.MODE === 'test') &&
    (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ ===
      true;
  return {
    isLoaded,
    email: lower,
    isOwner: forceOwner || (!!lower && ownerEmails.has(lower)),
  };
}
