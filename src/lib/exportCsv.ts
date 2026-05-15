import type { Activity } from '../data/types';
import { activities as STATIC_ACTIVITIES } from '../data/activities';

// Column order is part of the public contract — see issue #28.
const COLUMNS = [
  'id',
  'name',
  'shortDescription',
  'longDescription',
  'category',
  'region',
  'city',
  'lat',
  'lng',
  'duration',
  'durationDetail',
  'difficulty',
  'dogFriendly',
  'coverImage',
  'galleryImages',
  'allTrailsUrl',
  'allTrailsRating',
  'hikeDistanceMiles',
  'hikeElevationFeet',
  'completed',
  'completedDate',
  'notes',
  'source',
] as const;

const STATIC_IDS = new Set(STATIC_ACTIVITIES.map((a) => a.id));

/** static if the id appears in the seed array, otherwise user-added. */
export function isUserActivity(id: string): boolean {
  return !STATIC_IDS.has(id);
}

type CsvPrimitive = string | number | boolean | null | undefined;

/**
 * CSV-escape a single field. Quote when the value contains `,`, `"`, `\r`, or
 * `\n`; escape inner `"` as `""`. Spec: RFC 4180.
 */
export function csvEscape(value: CsvPrimitive): string {
  if (value === undefined || value === null) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtOptional(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function fmtBool(v: boolean | undefined): string {
  if (v === undefined) return '';
  return v ? 'true' : 'false';
}

function activityRow(a: Activity): string[] {
  return [
    a.id,
    a.name,
    a.shortDescription,
    fmtOptional(a.longDescription),
    a.category,
    a.region,
    a.location.city,
    String(a.location.coords.lat),
    String(a.location.coords.lng),
    a.duration,
    fmtOptional(a.durationDetail),
    fmtOptional(a.difficulty),
    fmtBool(a.dogFriendly),
    a.coverImage,
    (a.galleryImages ?? []).join('|'),
    fmtOptional(a.allTrailsUrl),
    fmtOptional(a.allTrailsRating),
    fmtOptional(a.hikeDistanceMiles),
    fmtOptional(a.hikeElevationFeet),
    fmtBool(a.completed),
    fmtOptional(a.completedDate),
    fmtOptional(a.notes),
    isUserActivity(a.id) ? 'user' : 'static',
  ];
}

/** Build the full CSV string for the given activity list. */
export function buildActivitiesCsv(list: Activity[]): string {
  const header = COLUMNS.join(',');
  const rows = list.map((a) => activityRow(a).map(csvEscape).join(','));
  // Trailing newline is conventional and makes single-row diffs cleaner.
  return [header, ...rows].join('\n') + '\n';
}

/** Local-date filename: `fog-and-frontier-activities-YYYY-MM-DD.csv`. */
export function csvFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `fog-and-frontier-activities-${y}-${m}-${d}.csv`;
}

/**
 * Browser-side download trigger. Builds the CSV from `list`, wraps it in a
 * Blob, and synthesizes an anchor click to save it.
 */
export function exportActivitiesToCsv(list: Activity[]): void {
  const csv = buildActivitiesCsv(list);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
