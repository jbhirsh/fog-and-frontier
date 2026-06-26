#!/usr/bin/env node
/**
 * Additive backfill: set `parkType` on existing Turso rows from the values in
 * src/data/activities.ts — WITHOUT clobbering any other fields.
 *
 * Turso (table `a`) is the source of truth for the live catalog; the static
 * file is only a seed. Re-running db:migrate-static would overwrite each row's
 * whole `j` blob from the static file, wiping any production-only edits. This
 * script instead reads each row's current JSON, sets only `parkType`, and
 * writes it back — so it's safe to run against production after rows have
 * diverged from the seed. Idempotent: rows already carrying the target value
 * are skipped.
 *
 * Usage:
 *   vercel env pull .env.prod --environment=production
 *   npm run db:backfill-park-types -- --dry-run   # preview, never writes
 *   npm run db:backfill-park-types                # interactive [y/N] confirm
 *   npm run db:backfill-park-types -- --yes       # skip the prompt (CI/agent)
 *   # or against a different env file:
 *   TURSO_ENV_FILE=.env.preview npm run db:backfill-park-types -- --dry-run
 *
 * Run under Node 22.6+/24 with --experimental-strip-types (the npm script adds
 * the flag) so the .ts seed import works without a build step.
 */

import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const assumeYes = argv.includes('--yes') || argv.includes('-y');

const envFile = process.env.TURSO_ENV_FILE ?? '.env.prod';
const envPath = resolve(process.cwd(), envFile);
if (!existsSync(envPath)) {
  console.error(
    `Missing ${envFile}. Run: vercel env pull ${envFile} --environment=<env>`,
  );
  process.exit(2);
}
process.loadEnvFile(envPath);

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error(`TURSO_DATABASE_URL not set in ${envFile}.`);
  process.exit(2);
}

const { activities } = await import('../src/data/activities.ts');
// Source of truth for seed activities: entries that declare a parkType.
const desired = new Map(
  activities
    .filter((a) => typeof a.parkType === 'string')
    .map((a) => [a.id, a.parkType]),
);

// Activities created directly in Turso (via the in-app Add flow) never existed
// in the static seed, so their designations can't live there. Hand-classified
// here so the backfill tags EVERY row, not just seeded ones. Keep this in sync
// if new prod-only activities need tagging; new activities added going forward
// get parkType from Gemini at creation time (api/generate-activity.ts).
const EXTRAS = {
  'las-trampas-to-mount-diablo-regional-trail': 'regional', // EBRPD regional trail
  'roaring-camp-railroads': 'private',
  'gilroy-gardens-family-theme-park': 'private', // gated theme park
  'the-horse-park-at-woodside': 'private',
  'angel-island-state-park': 'state',
  'mori-point-coastal-trail': 'national', // GGNRA
  'sequoia-national-park': 'national',
  'don-edwards-pink-salt-ponds': 'county', // salt ponds accessed via a county park
  'uvas-canyon-waterfall-loop': 'county', // Uvas Canyon County Park (SCC)
  'huntington-falls-golden-gate-park': 'city', // Golden Gate Park
  'tomales-point-trail': 'national', // Point Reyes National Seashore
  'coast-trail-point-reyes': 'national', // Point Reyes National Seashore
  'mount-umunhum-summit-trail': 'regional', // Sierra Azul OSP (Midpen)
  'refuge-spa-carmel-valley': 'none',
  'de-young-museum': 'none', // museum (in GG Park, but a museum)
  'rainbow-falls-golden-gate-park': 'city', // Golden Gate Park
  'sonoma-zipline-adventures': 'none', // commercial activity
  'natural-bridges-trail': 'none', // Vallecito (BLM, informal)
  'kirby-cove-golden-gate-views': 'national', // Marin Headlands GGNRA
  'cypress-grove-trail-point-lobos': 'state', // Point Lobos State Natural Reserve
  'big-sur-river-inn': 'none', // restaurant/inn
  'capitola-beach-village': 'city', // Capitola city beach
  'shadowbrook-restaurant-capitola': 'none', // restaurant
  'morro-bay-morro-rock': 'state', // Morro Rock State Natural Preserve
  'mineral-spring-trail-alum-rock-park': 'city', // Alum Rock Park (San Jose)
  'wapama-falls-trail-hetch-hetchy': 'national', // Yosemite National Park
  'cave-springs-resort-cabins': 'private',
  'fern-grotto-beach-mendocino': 'none', // informal Santa Cruz beach
  'pfeiffer-beach-keyhole-arch': 'none', // USFS Los Padres (no park tier)
  'mcarthur-burney-falls-memorial-state-park': 'state',
  'chimney-rock-trail': 'national', // Point Reyes National Seashore
  'lover-s-point-park-and-beach': 'city', // Pacific Grove city park
  'sierra-vista-open-space-preserve': 'regional', // Midpeninsula Regional Open Space District
  'garden-of-eden-swimming-hole': 'state', // Henry Cowell Redwoods SP
  'mccloud-falls-trail': 'none', // USFS Shasta-Trinity (no park tier)
  'redwood-grove-nature-preserve': 'city', // City of Los Altos
  'conzelman-road-scenic-drive': 'national', // Marin Headlands GGNRA
  'trees-of-mystery-redwood-park': 'private', // roadside attraction
  'russian-gulch-fern-canyon-waterfall-loop': 'state', // Russian Gulch State Park
};
for (const [id, parkType] of Object.entries(EXTRAS)) {
  if (!desired.has(id)) desired.set(id, parkType);
}

if (desired.size === 0) {
  console.error('No parkType assignments available — nothing to backfill.');
  process.exit(2);
}

console.log(`Target: ${url}`);
console.log(`Assignments (seed + prod-only): ${desired.size}`);

const client = createClient({ url, authToken: token });

const plan = []; // { id, parkType, j }
const missing = [];
for (const [id, parkType] of desired) {
  const rs = await client.execute({
    sql: 'SELECT j FROM a WHERE id = ?',
    args: [id],
  });
  if (rs.rows.length === 0) {
    missing.push(id);
    continue;
  }
  const raw = rs.rows[0].j;
  if (typeof raw !== 'string') {
    missing.push(id);
    continue;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    console.warn(`  ! ${id}: malformed JSON in Turso — skipping`);
    continue;
  }
  if (obj.parkType === parkType) continue; // already correct — idempotent
  plan.push({ id, parkType, j: { ...obj, parkType } });
}

if (missing.length) {
  console.log(
    `\nIn seed but not in Turso (${missing.length}, skipped): ${missing.join(', ')}`,
  );
}

if (plan.length === 0) {
  console.log('\nNothing to update — Turso already matches the seed.');
  process.exit(0);
}

console.log(`\nWill set parkType on ${plan.length} row(s):`);
for (const p of plan) console.log(`  - ${p.id} → ${p.parkType}`);

if (dryRun) {
  console.log('\n--dry-run: no changes written.');
  process.exit(0);
}

if (!assumeYes) {
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question(`\nProceed? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (ans !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }
}

const now = Date.now();
let written = 0;
for (const p of plan) {
  const json = JSON.stringify(p.j);
  if (json.length > 8000) {
    console.warn(`  ! ${p.id}: would exceed 8000-char cap — skipping`);
    continue;
  }
  await client.execute({
    sql: 'UPDATE a SET j = ?, t = ? WHERE id = ?',
    args: [json, now, p.id],
  });
  written++;
}

console.log(`\nUpdated ${written} row(s).`);
