// One-off (jbhirsh/ci#144, the cleanup's steps 4 to 7), on this throwaway
// branch only: never on main. Re-uploads the pictures one description links
// from old upload comments straight into it, swaps only their links, then
// deletes its upload comment; oneoff/phase.json names the description, its
// approved ids, the comment and the dry run. Two phases, each started by a
// push to this branch, so the session can wait for the runs edit 1 starts
// (`gh run watch`) between them; no timer anywhere.
//
//   phase1 <state dir>  checks, snapshot, edit 1 (BOT_PR_TOKEN), read back
//   phase2 <state dir>  checks, edit 2 (Actions token), delete, checks
//   fetch <state dir> <label>  signed-out fetch of the new and P1's links
//   dead <state dir>    the comments that back no link, each re-checked
//   restore <state dir> back to phase 1's snapshot, when phase 1 stopped after edit 1
//
// Every check refuses: no retry. A refusal after edit 1 removes only the
// temporary block, leaving the old links and the comment as they were.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
const REPO = String(env.REPO);
/** What this push runs on: oneoff/phase.json, one description (or the dead comments) at a time. */
const cfg = JSON.parse(readFileSync('oneoff/phase.json', 'utf8'));
const KIND = cfg.kind === 'issue' ? 'issue' : 'pr';
const PR = Number(cfg.number);
const COMMENT = cfg.comment == null ? null : Number(cfg.comment);
const EXPECTED = [...(cfg.expected ?? [])].sort();
const ROUTE = `repos/${REPO}/${KIND === 'pr' ? 'pulls' : 'issues'}/${PR}`;
const ART = String(env.ART);
const [cmd, stateDir, label] = process.argv.slice(2);
const API = 'https://api.github.com';
const ASSET = 'https://github.com/user-attachments/assets/';
const BANG = String.fromCharCode(33);
const OPEN = '<!-- ci144-reupload -->';
const CLOSE = '<!-- /ci144-reupload -->';
/** P1's links (ci#149, ci#150) and their files' sha256. */
const P1 = {
  'cf935817-5d7d-4732-9b8f-45f22da7d818': 'd24383074b1cde8aff59541f24468d5d9f30cc98ac69ef3356117a0a1c1c2785',
  'b160e02c-4af5-4fd8-a94b-e6f5520cd94a': '9b35c535c7233bddfafc2dab76f43cd2d1609108fc81b0683efa43ddd162d57a',
  '19cde818-08d9-42c9-a7fa-fa7b62bf411f': 'd24383074b1cde8aff59541f24468d5d9f30cc98ac69ef3356117a0a1c1c2785',
  '4d1a1ae3-a185-45dd-97d1-b68309eb927b': '9b35c535c7233bddfafc2dab76f43cd2d1609108fc81b0683efa43ddd162d57a',
};

const sha256 = (/** @type {Buffer} */ b) => createHash('sha256').update(b).digest('hex');
const statePath = path.join(stateDir, 'state.json');
const load = () => JSON.parse(readFileSync(statePath, 'utf8'));
const save = (/** @type {any} */ s) => writeFileSync(statePath, JSON.stringify(s, null, 2));
const log = (/** @type {any} */ s, /** @type {string} */ line) => {
  console.log(line);
  s.log.push(`${new Date().toISOString()} ${line}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
};

/**
 * One GitHub API call with the Actions token, through gh, each in its own
 * process: a fresh connection every time. (Node's fetch reuses a pooled
 * connection, which GitHub had closed during edit 1's minute of uploads:
 * the read-back right after it failed with "other side closed".)
 *
 * @param {string} method
 * @param {string} route
 * @param {unknown} [body]
 */
async function api(method, route, body) {
  const args = ['api', '-X', method, route, '-i', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  let input;
  if (body) {
    args.push('--input', '-');
    input = JSON.stringify(body);
  }
  let out;
  try {
    out = execFileSync('gh', args, { input, encoding: 'utf8', env: { ...env, GH_TOKEN: env.ACTIONS_TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = String(/** @type {{ stdout?: string }} */ (e).stdout ?? '');
    if (!/^HTTP\/\S+ \d{3}/.test(out)) throw e;
  }
  const status = Number(/^HTTP\/\S+ (\d{3})/.exec(out)?.[1]);
  const split = out.search(/\r?\n\r?\n/);
  const text = split === -1 ? '' : out.slice(split).trim();
  return { status, json: text ? JSON.parse(text) : null };
}

async function readBody() {
  const r = await api('GET', ROUTE);
  if (r.status !== 200) throw new Error(`GET ${ROUTE}: ${r.status}`);
  return /** @type {string} */ (r.json.body ?? '');
}

/** @param {string} body */
async function writeBody(body) {
  const r = await api('PATCH', ROUTE, { body });
  if (r.status !== 200) throw new Error(`PATCH ${ROUTE}: ${r.status}`);
}

/**
 * A signed-out fetch: no header, the redirect followed.
 *
 * @param {string} url
 */
async function signedOut(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { status: res.status };
    return { status: res.status, sha256: sha256(Buffer.from(await res.arrayBuffer())) };
  } catch (e) {
    return { status: String(e) };
  }
}

/** The description with the temporary block cut out (or itself, when it has none). */
function cut(/** @type {string} */ body) {
  const from = body.indexOf(`\n\n${OPEN}\n`);
  const to = body.indexOf(`${CLOSE}\n`);
  if (from === -1 || to === -1 || to < from) return body;
  return body.slice(0, from) + body.slice(to + CLOSE.length + 1);
}

/** Set from just before edit 1 until edit 2 is written: what a failure takes the description back to. */
let restoreTo = /** @type {string | null} */ (null);
let current = /** @type {any} */ ({ log: [] });

/**
 * Takes the description back to the snapshot by cutting out only the
 * temporary block; touches nothing when anything else differs.
 *
 * @param {any} s
 */
async function restoreSnapshot(s) {
  const snapshot = /** @type {string} */ (restoreTo);
  restoreTo = null;
  const now = await readBody();
  if (now === snapshot) return log(s, 'the description already equals its snapshot');
  if (cut(now) !== snapshot) return log(s, 'STOP: the description is not its snapshot plus the temporary block; not touched');
  await writeBody(snapshot);
  const back = await readBody();
  log(s, `restored: the temporary block cut out; the description ${back === snapshot ? 'equals' : 'DIFFERS FROM'} its snapshot`);
}

/**
 * Refuses: takes the description back to its snapshot when edit 1 has
 * run, then fails the run.
 *
 * @param {any} s
 * @param {string} why
 */
async function refuse(s, why) {
  log(s, `REFUSED: ${why}`);
  if (restoreTo !== null) await restoreSnapshot(s);
  save(s);
  process.exit(1);
}

const dry = JSON.parse(readFileSync(path.join(ART, 'dry-run.json'), 'utf8'));
/** Every asset id an upload comment in the dry run holds. */
const uploadIds = [...new Set(dry.found.flatMap((/** @type {any} */ c) => c.ids))];

try {
if (cmd === 'phase1') {
  mkdirSync(stateDir, { recursive: true });
  const s = current = { pr: PR, comment: COMMENT, log: /** @type {string[]} */ ([]), pictures: /** @type {any} */ ({}) };
  const where = `${KIND === 'pr' ? 'PR' : 'issue'} #${PR}'s description`;
  const listed = Object.keys(dry.places)
    .filter((id) => dry.places[id].some((/** @type {any} */ p) => p.where === where))
    .sort();
  if (!cfg.test && JSON.stringify(listed) !== JSON.stringify(EXPECTED)) {
    log(s, `the dry run's ids for #${PR} (${listed}) aren't the approved list (${EXPECTED})`);
    process.exit(1);
  }
  mkdirSync('reupload', { recursive: true });
  for (const id of EXPECTED) {
    const pic = dry.pictures[id];
    const bytes = readFileSync(path.join(ART, pic.file));
    const old = await signedOut(ASSET + id);
    s.pictures[id] = { file: pic.file, sha256: sha256(bytes), dryRun: pic.sha256, oldFetch: old };
    if (sha256(bytes) !== pic.sha256 || old.status !== 200 || old.sha256 !== pic.sha256) {
      log(s, `${id}: artifact ${sha256(bytes).slice(0, 12)}, dry run ${pic.sha256.slice(0, 12)}, old link ${old.status} ${old.sha256?.slice(0, 12)}: not all equal`);
      process.exit(1);
    }
    copyFileSync(path.join(ART, pic.file), path.join('reupload', `${id}.png`));
    log(s, `${id}: artifact file, dry run and a signed-out fetch of the old link agree (${pic.sha256.slice(0, 12)})`);
  }
  const snapshot = await readBody();
  writeFileSync(path.join(stateDir, 'before.md'), snapshot);
  const inBody = uploadIds.filter((id) => snapshot.includes(id)).sort();
  if (JSON.stringify(inBody) !== JSON.stringify(EXPECTED)) {
    log(s, `the description links upload-comment ids ${inBody}, not the approved ${EXPECTED}`);
    process.exit(1);
  }
  const block = `\n\n${OPEN}\n${EXPECTED.map((id) => `${BANG}[${id}](./reupload/${id}.png)`).join('\n')}\n${CLOSE}\n`;
  // At the end of the description, or, with `inside`, inside visual
  // review's own block, so its find skips the edit on an open PR.
  const endMark = '<!-- /describe:visual-review -->';
  if (cfg.inside && snapshot.indexOf(endMark) !== snapshot.lastIndexOf(endMark)) {
    log(s, 'visual review\'s block closes more than once');
    process.exit(1);
  }
  const at = cfg.inside ? snapshot.indexOf(endMark) : snapshot.length;
  if (at === -1) {
    log(s, 'no visual-review block to put the temporary block inside');
    process.exit(1);
  }
  const body1 = snapshot.slice(0, at) + block + snapshot.slice(at);
  if (cut(body1) !== snapshot) throw new Error('cut() does not undo the temporary block');
  if (body1.length + EXPECTED.length * 100 > 65_536 || EXPECTED.length > 50) {
    log(s, `too big for one edit: ${body1.length} characters, ${EXPECTED.length} files`);
    process.exit(1);
  }
  writeFileSync(path.join(stateDir, 'body1.md'), body1);
  log(s, `snapshot: ${snapshot.length} characters, ${snapshot.split('\n').length} lines, ${(snapshot.match(/\r/g) ?? []).length} CR; it links exactly the ${EXPECTED.length} approved ids`);
  s.edit1At = new Date().toISOString();
  s.snapshot = snapshot;
  restoreTo = snapshot;
  execFileSync(
    'gh',
    [KIND, 'edit', String(PR), '--repo', REPO, '--body-file', path.join(stateDir, 'body1.md'), ...EXPECTED.flatMap((id) => ['--attach', `./reupload/${id}.png`])],
    { env: { ...env, GH_TOKEN: env.UPLOAD_TOKEN }, stdio: 'inherit' },
  );
  log(s, `edit 1 (BOT_PR_TOKEN) at ${s.edit1At}`);
  if (cfg.forceReadBackFailure) throw new Error('forced read-back failure (a test of the restore)');
  const after = await readBody();
  writeFileSync(path.join(stateDir, 'edit1.md'), after);
  s.edit1Body = after;
  if (cut(after) !== snapshot) await refuse(s, 'edit 1 changed the description outside the temporary block, or gh appended to it');
  const tail = after.slice(after.indexOf(`\n\n${OPEN}\n`));
  const close = tail.indexOf(CLOSE);
  s.appended = '';
  s.newLinks = {};
  for (const id of EXPECTED) {
    const m = new RegExp(`${BANG}\\[${id}\\]\\((${ASSET.replaceAll('.', '\\.').replaceAll('/', '\\/')}[0-9a-f-]+)\\)`).exec(tail.slice(0, close));
    if (!m) await refuse(s, `gh left ${id}'s path local`);
    else s.newLinks[id] = m[1];
  }
  log(s, `read back: ${Object.keys(s.newLinks).length} new links; ${JSON.stringify(s.appended)} after the block`);
  save(s);
} else if (cmd === 'phase2') {
  const s = current = load();
  restoreTo = s.snapshot;
  const now = await readBody();
  if (now !== s.edit1Body) await refuse(s, 'the description changed since edit 1 (one of its runs, or a person, wrote it)');
  log(s, 'the description is exactly as edit 1 left it, after its runs ended');
  for (const id of EXPECTED) {
    const got = await signedOut(s.newLinks[id]);
    s.pictures[id].newBefore = got;
    if (got.status !== 200 || got.sha256 !== s.pictures[id].sha256) {
      await refuse(s, `${s.newLinks[id]} answered ${got.status} ${got.sha256?.slice(0, 12) ?? ''}, not the artifact's bytes`);
    }
    log(s, `${id} -> ${s.newLinks[id]}: 200 signed out, sha256 matches (${got.sha256?.slice(0, 12)})`);
  }
  // Edit 2: the snapshot, with only the approved links swapped. Since the
  // description equals edit 1's (the snapshot, then the block, then what gh
  // appended), dropping the block and the appended text gives the snapshot.
  const base = cut(now);
  if (base !== s.snapshot) await refuse(s, 'what precedes the temporary block is not the snapshot');
  let edit2 = base;
  /** @type {Record<string, number>} */
  const swaps = {};
  for (const id of EXPECTED) {
    swaps[id] = edit2.split(ASSET + id).length - 1;
    edit2 = edit2.replaceAll(ASSET + id, s.newLinks[id]);
  }
  let expected = s.snapshot;
  for (const id of EXPECTED) expected = expected.replaceAll(ASSET + id, s.newLinks[id]);
  if (edit2 !== expected) await refuse(s, 'edit 2 is not the snapshot with only the links swapped');
  if (uploadIds.some((id) => edit2.includes(id))) await refuse(s, 'edit 2 still links an upload-comment id');
  if (Object.values(swaps).some((n) => n < 1)) await refuse(s, `an approved id wasn't in the description: ${JSON.stringify(swaps)}`);
  restoreTo = null;
  await writeBody(edit2);
  writeFileSync(path.join(stateDir, 'after.md'), edit2);
  s.swaps = swaps;
  if ((await readBody()) !== edit2) {
    log(s, 'STOP: the description read back after edit 2 is not what it wrote');
    save(s);
    process.exit(1);
  }
  log(s, `edit 2 (Actions token): ${Object.values(swaps).reduce((a, b) => a + b, 0)} links swapped (${JSON.stringify(swaps)}); read back equal`);
  if (COMMENT === null) {
    log(s, 'no comment to delete for this description');
    save(s);
    process.exit(0);
  }
  // Never delete a comment while any description still links its old ids.
  const own = dry.found.find((/** @type {any} */ c) => c.id === COMMENT);
  if (!own) await refuse(s, `comment ${COMMENT} isn't in the dry run`);
  /** @type {any[]} */
  const issues = [];
  for (let page = 1; ; page++) {
    const r = await api('GET', `repos/${REPO}/issues?state=all&per_page=100&page=${page}`);
    if (r.status !== 200) throw new Error(`list issues: ${r.status}`);
    issues.push(...r.json);
    if (r.json.length < 100) break;
  }
  const still = issues.filter((i) => own.ids.some((/** @type {string} */ id) => String(i.body ?? '').includes(id)));
  if (still.length > 0) {
    log(s, `STOP: comment ${COMMENT}'s ids are still linked from ${still.map((i) => `#${i.number}`).join(', ')}; not deleted`);
    save(s);
    process.exit(1);
  }
  log(s, `no description among ${issues.length} links comment ${COMMENT}'s ${own.ids.length} ids any more`);
  const del = await api('DELETE', `repos/${REPO}/issues/comments/${COMMENT}`);
  const gone = await api('GET', `repos/${REPO}/issues/comments/${COMMENT}`);
  log(s, `delete of comment ${COMMENT} (Actions token): ${del.status}; it now answers ${gone.status}`);
  if (del.status !== 204 || gone.status !== 404) {
    save(s);
    process.exit(1);
  }
  if ((await readBody()) !== edit2) {
    log(s, 'STOP: the description changed after the delete');
    save(s);
    process.exit(1);
  }
  log(s, 'the description read back after the delete is still edit 2');
  save(s);
} else if (cmd === 'restore') {
  // Phase 1 stopped after edit 1 without its refusal (a dropped connection
  // on the read-back): take the description back to phase 1's snapshot,
  // removing only the temporary block. Nothing else may differ.
  const s = { log: /** @type {string[]} */ ([]) };
  const before = readFileSync(path.join(stateDir, 'before.md'), 'utf8');
  const now = await readBody();
  const tail = now.slice(before.length);
  if (!now.startsWith(before) || !tail.startsWith(`\n\n${OPEN}\n`) || !tail.trimEnd().endsWith(CLOSE)) {
    log(s, 'STOP: the description is not the snapshot plus the temporary block; not touched');
    process.exit(1);
  }
  await writeBody(before);
  const back = await readBody();
  log(s, `temporary block removed (${tail.length} characters); the description ${back === before ? 'equals' : 'DIFFERS FROM'} phase 1's snapshot`);
  if (back !== before) process.exit(1);
  mkdirSync(stateDir, { recursive: true });
  save(s);
} else if (cmd === 'dead') {
  // The comments that back no link: each re-checked right before its delete.
  mkdirSync(stateDir, { recursive: true });
  const s = { log: /** @type {string[]} */ ([]) };
  /** @type {any[]} */
  const issues = [];
  for (let page = 1; ; page++) {
    const r = await api('GET', `repos/${REPO}/issues?state=all&per_page=100&page=${page}`);
    if (r.status !== 200) throw new Error(`list issues: ${r.status}`);
    issues.push(...r.json);
    if (r.json.length < 100) break;
  }
  for (const id of cfg.dead) {
    const own = dry.found.find((/** @type {any} */ c) => c.id === id);
    if (!own) {
      log(s, `STOP: comment ${id} isn't in the dry run`);
      save(s);
      process.exit(1);
    }
    const now = await api('GET', `repos/${REPO}/issues/comments/${id}`);
    if (now.status !== 200) {
      log(s, `STOP: comment ${id} is gone already (${now.status})`);
      save(s);
      process.exit(1);
    }
    /** @type {any[]} */
    const comments = [];
    for (let page = 1; ; page++) {
      const r = await api('GET', `repos/${REPO}/issues/comments?per_page=100&page=${page}`);
      if (r.status !== 200) throw new Error(`list comments: ${r.status}`);
      comments.push(...r.json);
      if (r.json.length < 100) break;
    }
    const linked = [
      ...issues.filter((i) => own.ids.some((/** @type {string} */ x) => String(i.body ?? '').includes(x))).map((i) => `#${i.number}'s description`),
      ...comments.filter((c) => c.id !== id && own.ids.some((/** @type {string} */ x) => String(c.body ?? '').includes(x))).map((c) => `comment ${c.id}`),
    ];
    if (linked.length > 0) {
      log(s, `STOP: comment ${id}'s ids are linked from ${linked.join(', ')}; not deleted`);
      save(s);
      process.exit(1);
    }
    const del = await api('DELETE', `repos/${REPO}/issues/comments/${id}`);
    const gone = await api('GET', `repos/${REPO}/issues/comments/${id}`);
    log(s, `comment ${id} (#${own.number}, ${own.ids.length} pictures, linked nowhere among ${issues.length} descriptions and ${comments.length - 1} other comments): delete ${del.status}, now ${gone.status}`);
    if (del.status !== 204 || gone.status !== 404) {
      save(s);
      process.exit(1);
    }
  }
  save(s);
} else if (cmd === 'fetch') {
  const s = load();
  s.fetches ??= [];
  let bad = 0;
  const links = [
    ...EXPECTED.map((id) => [s.newLinks[id], s.pictures[id].sha256, `new for ${id}`]),
    ...Object.entries(P1).map(([id, h]) => [ASSET + id, h, 'P1']),
  ];
  for (const [url, want, what] of links) {
    const got = await signedOut(url);
    const ok = got.status === 200 && got.sha256 === want;
    if (!ok) bad++;
    s.fetches.push({ label, url, what, ...got, ok });
    log(s, `fetch ${label}: ${what} ${url} -> ${got.status}${got.sha256 ? ` sha256 ${ok ? 'matches' : 'DIFFERS'}` : ''}`);
  }
  save(s);
  if (bad > 0) process.exit(1);
} else {
  throw new Error(`unknown command ${cmd}`);
}
} catch (e) {
  // Any failure between edit 1 and edit 2 takes the description back to
  // its snapshot first (the refusal step), then fails the run.
  log(current, `FAILED: ${e instanceof Error ? e.message : String(e)}`);
  if (restoreTo !== null) await restoreSnapshot(current);
  try {
    save(current);
  } catch {
    // no state dir yet
  }
  process.exit(1);
}
