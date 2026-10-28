import { createContext, useContext } from 'react';

/**
 * Where a page puts its own controls in the header's one row: the catalog's
 * Filters, view toggle and actions sit there, between the search and the
 * nav. `undefined` outside Layout (a page rendered alone, as in its tests,
 * draws them itself); `null` until the row has mounted.
 */
export const HeaderSlotContext = createContext<HTMLElement | null | undefined>(undefined);

export function useHeaderSlot(): HTMLElement | null | undefined {
  return useContext(HeaderSlotContext);
}
