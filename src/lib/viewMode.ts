import type { ViewMode } from '../components/ViewModeToggle';

/**
 * Narrow an arbitrary string (e.g. the `?view=` URL param) to a {@link ViewMode}.
 * Lives apart from the `ViewModeToggle` component so importing it doesn't pull a
 * non-component export into that module (react-refresh keeps component files
 * component-only).
 */
export function isViewMode(value: string | null | undefined): value is ViewMode {
  return value === 'list' || value === 'split' || value === 'map';
}
