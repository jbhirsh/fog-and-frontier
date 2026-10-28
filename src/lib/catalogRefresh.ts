import { useEffect } from 'react';
import { apolloClient } from './apolloClient';
import { ACTIVITIES_QUERY, COMPLETED_QUERY } from './gqlDocs';

/** How old the catalog may get before coming back to the app refetches it. */
export const CATALOG_STALE_MS = 5 * 60 * 1000;

/**
 * The catalog and the completion overrides are read cache-first, so every
 * card and every step through the detail reads them without a fetch. A tab
 * left open, or the installed app resumed days later, would then keep
 * showing them as they were, and an edit started there would overwrite
 * another owner's newer save. Coming back to the app once they're
 * CATALOG_STALE_MS old refetches them, once.
 */
export function useCatalogRefresh(): void {
  useEffect(() => {
    let readAt = Date.now();
    const onVisible = () => {
      if (document.hidden || Date.now() - readAt < CATALOG_STALE_MS) return;
      readAt = Date.now();
      void apolloClient
        .refetchQueries({ include: [ACTIVITIES_QUERY, COMPLETED_QUERY] })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}
