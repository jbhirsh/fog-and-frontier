// The app's side of regions (#274): each region's label, and finding one by
// what's typed. The list is shared/regions.ts; its 3,600 ISO entries load
// only when something asks for them (loadRegionOptions), so the app's first
// load doesn't carry them.

import type { ISO_REGIONS } from '../../shared/isoRegions';
import { CALIFORNIA_REGIONS, type Region } from '../../shared/regions';

/** A region as the picker offers it. */
export interface RegionOption {
  id: Region;
  /** "Kyoto, Japan", "Hong Kong", "North Bay". */
  label: string;
  /** Its label and id, folded for matching. */
  key: string;
}

// Letters that decomposing doesn't strip to plain Latin, as they're spelled out.
const SPELLED: Readonly<Record<string, string>> = {
  ð: 'd',
  đ: 'd',
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
};

/** Lower case, without accents: "Höfuðborgarsvæði" matches "hofudborgarsvaedi". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ðđæøœßþ]/g, (c) => SPELLED[c]);
}

function option(id: Region, label: string, also = ''): RegionOption {
  return { id, label, key: fold(`${label} ${also} ${id}`) };
}

/**
 * California's areas, each found by "California" too: the state is divided
 * into them, so it isn't a region of its own.
 */
export function californiaOptions(): RegionOption[] {
  return CALIFORNIA_REGIONS.map(([id, name]) => option(id, name, 'California'));
}

/** California's areas, then every ISO region, each with its label. */
export function regionOptions(iso: typeof ISO_REGIONS): RegionOption[] {
  return [
    ...californiaOptions(),
    ...iso.map(([id, name, country]) => option(id, country ? `${name}, ${country}` : name)),
  ];
}

let loading: Promise<RegionOption[]> | undefined;

/**
 * Every region, loaded once, when first asked for. A load that fails (a tab
 * open across a deploy asks for a file that's gone) is tried again next time.
 */
export function loadRegionOptions(): Promise<RegionOption[]> {
  loading ??= import('../../shared/isoRegions').then(
    ({ ISO_REGIONS }) => regionOptions(ISO_REGIONS),
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** A California area's label, without loading the rest; undefined for any other. */
export function californiaLabel(id: string): string | undefined {
  return CALIFORNIA_REGIONS.find(([area]) => area === id)?.[1];
}

/** The words of folded text: its runs of letters and digits. */
function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The regions matching `query`, best first, at most `limit`: every word typed
 * must start a word of the label or id. One whose label starts with the query
 * comes first, then the list's own order (California's areas, then by
 * country). An empty query offers California's areas.
 */
export function searchRegions(
  options: readonly RegionOption[],
  query: string,
  limit = 8,
): RegionOption[] {
  const words = wordsOf(fold(query));
  if (words.length === 0) return options.slice(0, Math.min(limit, CALIFORNIA_REGIONS.length));
  const prefix = words.join(' ');
  const matches = options.filter((o) => {
    const starts = wordsOf(o.key);
    return words.every((w) => starts.some((s) => s.startsWith(w)));
  });
  const first = matches.filter((o) => o.key.startsWith(prefix));
  const rest = matches.filter((o) => !o.key.startsWith(prefix));
  return [...first, ...rest].slice(0, limit);
}
