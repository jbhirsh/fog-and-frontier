// Fails a PR that changes the UI but shows none of it. Reads the PR's changed
// files (one path per line on stdin) and its description (PR_BODY). A change
// to a component or a stylesheet needs a picture in the description (an
// image, a GIF or a GitHub-uploaded video), or the template's ticked
// "No visible UI change" box for a change nobody can see (a refactor, a test
// helper). Whether a change to motion also needs a GIF is a judgment call, so
// Claude Review makes it (see claude-review.yml), not this script.
//
// It only knows components and stylesheets under src/: UI that changes
// through a .ts module, index.html or public/ isn't caught, nor is a
// reference-style markdown image (![alt][ref]). Reviewers cover those.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UI_FILE = /^src\/.+\.(tsx|css)$/;
const NOT_UI = /(\.test\.tsx$|^src\/test\/)/;

// Markdown or HTML images (GIFs included), HTML video, and the bare
// user-attachments URL GitHub inserts for a video dropped into the editor.
const VISUAL = [
  /!\[[^\]]*\]\([^)]+\)/,
  /<img\s[^>]*src=/i,
  /<video\s/i,
  /https:\/\/github\.com\/user-attachments\/assets\//,
];
const OPT_OUT = /^\s*[-*]\s*\[[xX]\]\s*No visible UI change/m;

export function uiFiles(files) {
  return files.filter((f) => UI_FILE.test(f) && !NOT_UI.test(f));
}

// Drops HTML comments the way GitHub's renderer hides them: from each
// `<!--` to the next `-->`, and an unclosed one hides the rest. A scan, not a
// regex replace, so no `<!--` can survive the removal.
function withoutComments(text) {
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf('<!--', from);
    if (start === -1) return out + text.slice(from);
    out += text.slice(from, start);
    const end = text.indexOf('-->', start + 4);
    if (end === -1) return out;
    from = end + 3;
  }
}

// What renders: the template's example table sits in an HTML comment, and a
// tag quoted in code isn't a picture, so neither may count.
export function visibleText(body) {
  return withoutComments(body ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

export function checkPrVisuals({ files, body }) {
  const ui = uiFiles(files);
  if (ui.length === 0) return { ok: true, reason: 'no UI files changed' };
  const text = visibleText(body);
  if (OPT_OUT.test(text)) return { ok: true, reason: 'marked "No visible UI change"' };
  if (VISUAL.some((re) => re.test(text))) return { ok: true, reason: 'description shows the change' };
  return { ok: false, ui };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const result = checkPrVisuals({ files, body: process.env.PR_BODY });
  if (result.ok) {
    console.log(`PR visuals: ok (${result.reason}).`);
  } else {
    console.log(
      [
        '::error::This PR changes the UI but its description shows none of it.',
        'Changed UI files:',
        ...result.ui.map((f) => `  ${f}`),
        'Add before/after screenshots to the description (a GIF when the change',
        'affects motion or interaction), or tick "No visible UI change" in the',
        'template. Editing the description re-runs this check.',
      ].join('\n'),
    );
    process.exit(1);
  }
}
