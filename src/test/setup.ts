import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// useUserActivities pulls /api/activities once on mount. In tests we don't
// hit the network — stub fetch to reject so the catch path keeps whatever the
// test seeded into localStorage. Individual tests can override via vi.stubGlobal.
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

afterEach(() => {
  cleanup();
  localStorage.clear();
});
