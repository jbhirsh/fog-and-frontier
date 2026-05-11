import { useAuthState } from './authShim';

const ownerEmails = new Set(
  ((import.meta.env.VITE_OWNER_EMAILS as string | undefined) ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

// UI hint only — server-side requireOwner is the actual gate.
export function useOwner(): {
  isOwner: boolean;
  isLoaded: boolean;
  email: string | null;
} {
  const { isLoaded, email } = useAuthState();
  const lower = email?.trim().toLowerCase() ?? null;
  return {
    isLoaded,
    email: lower,
    isOwner: !!lower && ownerEmails.has(lower),
  };
}
