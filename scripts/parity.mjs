#!/usr/bin/env node
// Sandbox ↔ app parity check for the vendored editables.
//
// Every paired file is normalised before diffing, so only REAL drift shows:
//   1. sandbox names are renamed to their app counterparts (classes, selectors, file names) on
//      BOTH sides — app comments copied verbatim keep sandbox names; those are counted separately
//      in the "stale" column instead of drowning the diff;
//   2. both sides are formatted with the same Prettier config;
//   3. TS imports collapse to a sorted symbol list (paths differ by design, symbols must not);
//   4. SCSS @use/@forward/@import paths reduce to their basename.
//
// Each drifting pair is classed `comments` (identical once comments are stripped — the doc-sync
// work) or `CODE`; `moved` counts lines that only changed position.
//
// Usage:
//   node scripts/parity.mjs                 summary table
//   node scripts/parity.mjs --diff          summary + unified diff per drifting pair
//   node scripts/parity.mjs --diff phone    only pairs whose label contains "phone"
//   IUSTA_APP=/path/to/iusta-core-frontend node scripts/parity.mjs
//
// Exits 1 when any pair drifts or a paired file is missing.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ROOT = resolve(
  process.env.IUSTA_APP ?? join(ROOT, '../../iusta-repo/iusta-core-frontend'),
);

const SB = 'projects/angular-inline-select';
const E = 'src/app/content/partials/common/editables';
const CE = 'src/app/core/editables';
const DT = 'src/app/core/datetime';
const SASS = 'src/assets/sass/global/components/iusta';

// [label, sandbox file(s), app file]. Several sandbox files are concatenated in order;
// `{ inlineStylesOf }` compares a sandbox component's inline `styles` with the app's stylesheet.
const PAIRS = [
  // text core
  [
    'text.ts',
    `${SB}/src/lib/angular-inline-text/angular-inline-text.ts`,
    `${E}/editable-inline/editable-inline.ts`,
  ],
  [
    'text.html',
    `${SB}/src/lib/angular-inline-text/angular-inline-text.html`,
    `${E}/editable-inline/editable-inline.html`,
  ],
  [
    'text.scss',
    `${SB}/src/lib/angular-inline-text/angular-inline-text.scss`,
    `${E}/editable-inline/editable-inline.scss`,
  ],
  [
    'text.spec',
    `${SB}/src/lib/angular-inline-text/angular-inline-text.spec.ts`,
    `${E}/editable-inline/editable-inline.spec.ts`,
  ],
  ['text/caret', `${SB}/src/lib/angular-inline-text/caret.ts`, `${E}/editable-inline/caret.ts`],
  [
    'text/affix',
    `${SB}/src/lib/angular-inline-text/editable-affix.ts`,
    `${E}/editable-inline/editable-affix.ts`,
  ],
  [
    'text/error',
    `${SB}/src/lib/angular-inline-text/editable-error.ts`,
    `${E}/editable-inline/editable-error.ts`,
  ],
  [
    'text/hint',
    `${SB}/src/lib/angular-inline-text/editable-hint.ts`,
    `${E}/editable-inline/editable-hint.ts`,
  ],
  [
    'text/menu',
    `${SB}/src/lib/angular-inline-text/editable-menu.ts`,
    `${E}/editable-inline/editable-menu.ts`,
  ],
  [
    'text/panel-actions',
    `${SB}/src/lib/angular-inline-text/editable-panel-actions.ts`,
    `${E}/editable-inline/editable-panel-actions.ts`,
  ],
  [
    'text/intl',
    `${SB}/src/lib/angular-inline-text/editable-text-intl.ts`,
    `${E}/editable-inline/editable-text-intl.ts`,
  ],
  [
    'text/paint.spec',
    `${SB}/src/lib/styles/editable-text-paint.spec.ts`,
    `${E}/editable-inline/editable-inline-paint.spec.ts`,
  ],
  [
    'bubble.ts',
    `${SB}/src/lib/bubble-menu/bubble-menu.ts`,
    `${E}/editable-inline/bubble-menu/bubble-menu.ts`,
  ],
  [
    'bubble.html',
    `${SB}/src/lib/bubble-menu/bubble-menu.html`,
    `${E}/editable-inline/bubble-menu/bubble-menu.html`,
  ],
  [
    'bubble.scss',
    `${SB}/src/lib/bubble-menu/bubble-menu.scss`,
    `${E}/editable-inline/bubble-menu/bubble-menu.scss`,
  ],
  [
    'bubble.spec',
    `${SB}/src/lib/bubble-menu/bubble-menu.spec.ts`,
    `${E}/editable-inline/bubble-menu/bubble-menu.spec.ts`,
  ],
  [
    'bubble/actions',
    `${SB}/src/lib/bubble-menu/editable-actions.ts`,
    `${E}/editable-inline/bubble-menu/editable-actions.ts`,
  ],
  [
    'bubble/clear',
    `${SB}/src/lib/bubble-menu/editable-clear.ts`,
    `${E}/editable-inline/bubble-menu/editable-clear.ts`,
  ],
  // global styles: the sandbox splits what the app keeps in one partial
  [
    'styles/_editable',
    [`${SB}/src/lib/styles/_editable.scss`, `${SB}/src/lib/styles/_editable-text.scss`],
    `${SASS}/_editable.scss`,
  ],
  [
    'styles/_hover-scope',
    `${SB}/src/lib/styles/_editable-hover-scope.scss`,
    `${SASS}/_editable-hover-scope.scss`,
  ],
  // number
  [
    'number.ts',
    `${SB}/src/lib/angular-inline-number/angular-inline-number.ts`,
    `${E}/editable-number-v2/editable-number-v2.ts`,
  ],
  [
    'number.styles',
    { inlineStylesOf: `${SB}/src/lib/angular-inline-number/angular-inline-number.ts` },
    `${E}/editable-number-v2/editable-number-v2.scss`,
  ],
  [
    'number.html',
    `${SB}/src/lib/angular-inline-number/angular-inline-number.html`,
    `${E}/editable-number-v2/editable-number-v2.html`,
  ],
  [
    'number.spec',
    `${SB}/src/lib/angular-inline-number/angular-inline-number.spec.ts`,
    `${E}/editable-number-v2/editable-number-v2.spec.ts`,
  ],
  // utils
  [
    'utils/hover-scope',
    `${SB}/src/lib/utils/editable-hover-scope/editable-hover-scope.ts`,
    `${CE}/directives/editable-hover-scope/editable-hover-scope.ts`,
  ],
  [
    'utils/hover-scope.spec',
    `${SB}/src/lib/utils/editable-hover-scope/editable-hover-scope.spec.ts`,
    `${CE}/directives/editable-hover-scope/editable-hover-scope.spec.ts`,
  ],
  [
    'utils/scope',
    `${SB}/src/lib/utils/editable-scope/editable-scope.ts`,
    `${CE}/directives/editable-scope/editable-scope.ts`,
  ],
  [
    'utils/scope.spec',
    `${SB}/src/lib/utils/editable-scope/editable-scope.spec.ts`,
    `${CE}/directives/editable-scope/editable-scope.spec.ts`,
  ],
  [
    'utils/link-detection',
    `${SB}/src/lib/utils/link-detection/link-detection.ts`,
    `${CE}/link-detection.ts`,
  ],
  [
    'utils/link-detection.spec',
    `${SB}/src/lib/utils/link-detection/link-detection.spec.ts`,
    `${CE}/link-detection.spec.ts`,
  ],
  [
    'utils/locale-number',
    `${SB}/src/lib/utils/locale-number/locale-number.ts`,
    `${CE}/number/locale-number.ts`,
  ],
  [
    'utils/locale-number.spec',
    `${SB}/src/lib/utils/locale-number/locale-number.spec.ts`,
    `${CE}/number/locale-number.spec.ts`,
  ],
  // phone
  [
    'phone.ts',
    `${SB}/phone/src/angular-inline-phone.ts`,
    `${E}/editable-telephone-number/editable-telephone-number.ts`,
  ],
  [
    'phone.styles',
    { inlineStylesOf: `${SB}/phone/src/angular-inline-phone.ts` },
    `${E}/editable-telephone-number/editable-telephone-number.scss`,
  ],
  [
    'phone.html',
    `${SB}/phone/src/angular-inline-phone.html`,
    `${E}/editable-telephone-number/editable-telephone-number.html`,
  ],
  [
    'phone.spec',
    `${SB}/phone/src/angular-inline-phone.spec.ts`,
    `${E}/editable-telephone-number/editable-telephone-number.spec.ts`,
  ],
  [
    'phone/codec',
    `${SB}/phone/src/phone-codec.ts`,
    `${E}/editable-telephone-number/phone-codec.ts`,
  ],
  [
    'phone/loader',
    `${SB}/phone/src/phone-codec-loader.ts`,
    `${E}/editable-telephone-number/phone-codec-loader.ts`,
  ],
  [
    'phone/loader.spec',
    `${SB}/phone/src/phone-codec-loader.spec.ts`,
    `${E}/editable-telephone-number/phone-codec-loader.spec.ts`,
  ],
  [
    'phone/libphonenumber',
    `${SB}/phone-libphonenumber/src/libphonenumber-codec.ts`,
    `${E}/editable-telephone-number/libphonenumber-codec.ts`,
  ],
  [
    'phone/libphonenumber.spec',
    `${SB}/phone-libphonenumber/src/libphonenumber-codec.spec.ts`,
    `${E}/editable-telephone-number/libphonenumber-codec.spec.ts`,
  ],
  // temporal: date
  [
    'date.ts',
    `${SB}/temporal/src/angular-inline-date/angular-inline-date.ts`,
    `${E}/editable-date-v2/editable-date-v2.ts`,
  ],
  [
    'date.html',
    `${SB}/temporal/src/angular-inline-date/angular-inline-date.html`,
    `${E}/editable-date-v2/editable-date-v2.html`,
  ],
  [
    'date.scss',
    `${SB}/temporal/src/angular-inline-date/angular-inline-date.scss`,
    `${E}/editable-date-v2/editable-date-v2.scss`,
  ],
  [
    'date.spec',
    `${SB}/temporal/src/angular-inline-date/angular-inline-date.spec.ts`,
    `${E}/editable-date-v2/editable-date-v2.spec.ts`,
  ],
  [
    'date/codec',
    `${SB}/temporal/src/angular-inline-date/date-codec.ts`,
    `${E}/editable-date-v2/date-codec.ts`,
  ],
  [
    'calendar.ts',
    `${SB}/temporal/src/angular-inline-date/calendar/calendar.ts`,
    `${E}/editable-date-v2/inline-calendar/inline-calendar.ts`,
  ],
  [
    'calendar.html',
    `${SB}/temporal/src/angular-inline-date/calendar/calendar.html`,
    `${E}/editable-date-v2/inline-calendar/inline-calendar.html`,
  ],
  [
    'calendar.scss',
    `${SB}/temporal/src/angular-inline-date/calendar/calendar.scss`,
    `${E}/editable-date-v2/inline-calendar/inline-calendar.scss`,
  ],
  [
    'calendar.spec',
    `${SB}/temporal/src/angular-inline-date/calendar/calendar.spec.ts`,
    `${E}/editable-date-v2/inline-calendar/inline-calendar.spec.ts`,
  ],
  // temporal: time
  [
    'time.ts',
    `${SB}/temporal/src/angular-inline-time/angular-inline-time.ts`,
    `${E}/editable-time/editable-time.ts`,
  ],
  [
    'time.html',
    `${SB}/temporal/src/angular-inline-time/angular-inline-time.html`,
    `${E}/editable-time/editable-time.html`,
  ],
  [
    'time.scss',
    `${SB}/temporal/src/angular-inline-time/angular-inline-time.scss`,
    `${E}/editable-time/editable-time.scss`,
  ],
  [
    'time.spec',
    `${SB}/temporal/src/angular-inline-time/angular-inline-time.spec.ts`,
    `${E}/editable-time/editable-time.spec.ts`,
  ],
  [
    'time/codec',
    `${SB}/temporal/src/angular-inline-time/time-codec.ts`,
    `${E}/editable-time/time-codec.ts`,
  ],
  [
    'time/day-offset',
    `${SB}/temporal/src/angular-inline-time/day-offset.ts`,
    `${E}/editable-time/day-offset.ts`,
  ],
  // temporal: duration
  [
    'duration.ts',
    `${SB}/temporal/src/angular-inline-duration/angular-inline-duration.ts`,
    `${E}/editable-time-duration/editable-time-duration.ts`,
  ],
  [
    'duration.html',
    `${SB}/temporal/src/angular-inline-duration/angular-inline-duration.html`,
    `${E}/editable-time-duration/editable-time-duration.html`,
  ],
  [
    'duration.scss',
    `${SB}/temporal/src/angular-inline-duration/angular-inline-duration.scss`,
    `${E}/editable-time-duration/editable-time-duration.scss`,
  ],
  [
    'duration.spec',
    `${SB}/temporal/src/angular-inline-duration/angular-inline-duration.spec.ts`,
    `${E}/editable-time-duration/editable-time-duration.spec.ts`,
  ],
  [
    'duration/codec',
    `${SB}/temporal/src/angular-inline-duration/duration-codec.ts`,
    `${E}/editable-time-duration/duration-codec.ts`,
  ],
  // temporal: shared
  [
    'temporal/_inline-unit',
    `${SB}/temporal/src/_inline-unit.scss`,
    `${CE}/temporal/_inline-unit.scss`,
  ],
  ['temporal/inline-unit', `${SB}/temporal/src/inline-unit.ts`, `${CE}/temporal/inline-unit.ts`],
  [
    'temporal/inline-unit.spec',
    `${SB}/temporal/src/inline-unit.spec.ts`,
    `${CE}/temporal/inline-unit.spec.ts`,
  ],
  [
    'temporal/interval-rounding',
    `${SB}/temporal/src/interval-rounding.ts`,
    `${CE}/temporal/interval-rounding.ts`,
  ],
  [
    'temporal/interval-rounding.spec',
    `${SB}/temporal/src/interval-rounding.spec.ts`,
    `${CE}/temporal/interval-rounding.spec.ts`,
  ],
  ['temporal/mat-control', `${SB}/temporal/src/mat-control.ts`, `${CE}/temporal/mat-control.ts`],
  ['temporal/leaf-state', `${SB}/temporal/src/leaf-state.ts`, `${CE}/temporal/leaf-state.ts`],
  ['temporal/side-session', `${SB}/temporal/src/side-session.ts`, `${CE}/temporal/side-session.ts`],
  [
    'temporal/side-session.spec',
    `${SB}/temporal/src/side-session.spec.ts`,
    `${CE}/temporal/side-session.spec.ts`,
  ],
  ['temporal/intl', `${SB}/temporal/src/temporal-intl.ts`, `${CE}/temporal/temporal-intl.ts`],
  [
    'temporal/intl.spec',
    `${SB}/temporal/src/temporal-intl.spec.ts`,
    `${CE}/temporal/temporal-intl.spec.ts`,
  ],
  [
    'temporal/range-group',
    `${SB}/temporal/src/range-group/range-group.ts`,
    `${CE}/temporal/range-group/range-group.ts`,
  ],
  [
    'temporal/range-group.spec',
    `${SB}/temporal/src/range-group/range-group.spec.ts`,
    `${CE}/temporal/range-group/range-group.spec.ts`,
  ],
  ['datetime/db-entry', `${SB}/temporal/src/datetime/db-entry.ts`, `${DT}/db-entry.ts`],
  [
    'datetime/db-entry.spec',
    `${SB}/temporal/src/datetime/db-entry.spec.ts`,
    `${DT}/db-entry.spec.ts`,
  ],
  ['datetime/iso-date', `${SB}/temporal/src/datetime/iso-date.ts`, `${DT}/iso-date.ts`],
  [
    'datetime/iso-date.spec',
    `${SB}/temporal/src/datetime/iso-date.spec.ts`,
    `${DT}/iso-date.spec.ts`,
  ],
  ['datetime/zone', `${SB}/temporal/src/datetime/zone.ts`, `${DT}/zone.ts`],
  // mat adapter
  [
    'mat-adapter',
    `${SB}/temporal-mat/src/mat-form-field-adapter.ts`,
    `${CE}/adapters/datetime/inline-mat-form-field.ts`,
  ],
  [
    'mat-adapter.spec',
    `${SB}/temporal-mat/src/mat-form-field-adapter.spec.ts`,
    `${CE}/adapters/datetime/inline-mat-form-field.spec.ts`,
  ],
];

// Sandbox → app names, applied to both sides. Longest first so prefixes never win early.
const RENAMES = [
  // file names (templateUrl / styleUrl / spec reads)
  [/\bangular-inline-text\.(html|scss|ts)\b/g, 'editable-inline.$1'],
  [/\bangular-inline-number\.(html|scss|ts)\b/g, 'editable-number-v2.$1'],
  [/\bangular-inline-phone\.(html|scss|ts)\b/g, 'editable-telephone-number.$1'],
  [/\bangular-inline-date\.(html|scss|ts)\b/g, 'editable-date-v2.$1'],
  [/\bangular-inline-duration\.(html|scss|ts)\b/g, 'editable-time-duration.$1'],
  [/\bangular-inline-time\.(html|scss|ts)\b/g, 'editable-time.$1'],
  [/(['/])calendar\.(html|scss|ts)\b/g, '$1inline-calendar.$2'],
  [/\bmat-form-field-adapter\b/g, 'inline-mat-form-field'],
  // selectors / element names
  [/\bangular-inline-text\b/g, 'm-editable-inline'],
  [/\bangular-inline-number\b/g, 'm-editable-number-v2'],
  [/\bangular-inline-phone\b/g, 'm-editable-telephone-number'],
  [/\bangular-inline-date\b/g, 'm-editable-date-v2'],
  [/\bangular-inline-duration\b/g, 'm-editable-time-duration'],
  [/\bangular-inline-time\b/g, 'm-editable-time'],
  [/\btemporal-calendar\b/g, 'm-inline-calendar'],
  // classes
  [/\bAngularInlineText\b/g, 'EditableInline'],
  [/\bAngularInlineNumber\b/g, 'EditableNumberV2'],
  [/\bAngularInlinePhone\b/g, 'EditableTelephoneNumber'],
  [/\bAngularInlineDate\b/g, 'EditableDateV2'],
  [/\bAngularInlineDuration\b/g, 'EditableTimeDuration'],
  [/\bAngularInlineTime\b/g, 'EditableTime'],
  [/\bCalendar\b/g, 'InlineCalendar'],
];

// A component's inline `styles` literal (backtick or single-quoted).
const INLINE_STYLES = /^\s*styles:\s*(?:`([\s\S]*?)`|'([^']*)'),?$/m;

// Sandbox names that should never appear in app files (the package name itself is fine).
const STALE_NAME = /\bangular-inline-(?!select\b)[a-z-]+|\bAngularInline[A-Z]\w*/g;

// Unpaired by decision; listed so a new file on either side is noticed, not silently skipped.
const SANDBOX_ONLY = [
  `${SB}/json/`, // decision 9: JSON not vendored yet
  `${SB}/src/lib/utils/editable-dialog/`,
  `${SB}/src/lib/styles/_editable-dialog.scss`,
  `${SB}/src/lib/styles/_editable-scrollbar.scss`,
  `${SB}/src/lib/styles/_editable-json.scss`,
  `${SB}/src/lib/utils/middle-ellipsis/`, // JSON-only; the app has its own directive
  `${SB}/src/lib/styles/_index.scss`,
  `${SB}/src/lib/gesture-conformance.spec.ts`,
  '/public-api.ts',
];

const PRETTIER = {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 120,
  tabWidth: 2,
  semi: true,
  bracketSpacing: true,
};
const PARSERS = { '.ts': 'typescript', '.html': 'angular', '.scss': 'scss' };

const args = process.argv.slice(2);
const showDiff = args.includes('--diff');
const filter = args.find((a) => !a.startsWith('--'));

if (!existsSync(APP_ROOT)) {
  console.error(`App repo not found at ${APP_ROOT} — set IUSTA_APP.`);
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'editable-parity-'));
let drift = 0;
const rows = [];
const diffs = [];

try {
  for (const [label, sbFiles, appFile] of PAIRS) {
    if (filter && !label.includes(filter)) continue;
    const inline = sbFiles.inlineStylesOf;
    const sbPaths = [inline ?? sbFiles].flat().map((f) => join(ROOT, f));
    const appPath = join(APP_ROOT, appFile);
    const missing = [...sbPaths, appPath].filter((p) => !existsSync(p));
    if (missing.length) {
      drift++;
      rows.push([
        label,
        `MISSING ${missing.map((p) => (p.startsWith(APP_ROOT) ? 'app' : 'sandbox')).join('+')}`,
      ]);
      continue;
    }

    const ext = extname(appPath);
    const sbRaw = sbPaths.map((p) => readFileSync(p, 'utf8')).join('\n');
    const sbText = inline
      ? dedent(
          sbRaw
            .match(INLINE_STYLES)
            ?.slice(1)
            .find((x) => x !== undefined) ?? '',
        )
      : sbRaw;
    const a = await normalise(rename(sbText), ext);
    const appText = readFileSync(appPath, 'utf8');
    const stale = (appText.match(STALE_NAME) ?? []).length;
    const staleNote = stale ? `  (${stale} stale sandbox name${stale > 1 ? 's' : ''} in app)` : '';
    const b = await normalise(rename(appText), ext);
    if (a === b) {
      rows.push([label, `ok${staleNote}`]);
      continue;
    }

    const safe = label.replace(/[^\w.-]+/g, '_');
    const fa = join(tmp, `sandbox__${safe}${ext}`);
    const fb = join(tmp, `app__${safe}${ext}`);
    writeFileSync(fa, a);
    writeFileSync(fb, b);
    const { stdout } = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', fa, fb], {
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    const lines = stdout.split('\n');
    const added = lines
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1));
    const removed = lines
      .filter((l) => l.startsWith('-') && !l.startsWith('---'))
      .map((l) => l.slice(1));
    const moved = countMoved(removed, added);
    const kind = stripComments(a, ext) === stripComments(b, ext) ? 'comments' : 'CODE    ';
    drift++;
    rows.push([
      label,
      `${kind}  −${removed.length} sandbox  +${added.length} app${moved ? `  (${moved} moved)` : ''}${staleNote}`,
    ]);
    diffs.push([label, lines.slice(4).join('\n')]);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const width = Math.max(...rows.map(([l]) => l.length));
for (const [label, status] of rows) console.log(`${label.padEnd(width)}  ${status}`);
console.log(`\n${rows.length - drift}/${rows.length} pairs identical after normalisation.`);
console.log(`Unpaired by decision: ${SANDBOX_ONLY.map((p) => p.replace(`${SB}/`, '')).join(', ')}`);

if (showDiff) {
  for (const [label, body] of diffs) console.log(`\n━━ ${label} (− sandbox / + app) ━━\n${body}`);
}
process.exit(drift ? 1 : 0);

// Lines that left one place and landed in another — reordering, not content drift.
function countMoved(removed, added) {
  const pool = new Map();
  for (const l of added.map((x) => x.trim()).filter(Boolean)) pool.set(l, (pool.get(l) ?? 0) + 1);
  let moved = 0;
  for (const l of removed.map((x) => x.trim()).filter(Boolean)) {
    if (pool.get(l)) {
      pool.set(l, pool.get(l) - 1);
      moved++;
    }
  }
  return moved;
}

// Comment-free reading of a normalised file: equal on both sides ⇒ the drift is comments only.
function stripComments(text, ext) {
  if (ext === '.ts') {
    const file = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    return ts.createPrinter({ removeComments: true }).printFile(file);
  }
  const bare =
    ext === '.html'
      ? text.replace(/<!--[\s\S]*?-->/g, '')
      : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  return bare
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .join('\n');
}

// Template-literal CSS carries the TS indentation; Prettier re-indents rules but not comment bodies.
function dedent(text) {
  const indents = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.match(/^ */)[0].length);
  const min = Math.min(...indents);
  return text
    .split('\n')
    .map((l) => l.slice(min))
    .join('\n');
}

function rename(text) {
  return RENAMES.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

async function normalise(text, ext) {
  let out = await prettier.format(text, { ...PRETTIER, parser: PARSERS[ext] });
  if (ext === '.ts') {
    // Inline `styles` vs `styleUrl` is packaging; the stylesheet itself is its own `*.styles` pair.
    out = collapseImports(out).replace(
      /^(\s*)(?:styles:\s*(?:`[\s\S]*?`|'[^']*')|styleUrls?:\s*(?:'[^']*'|\[[^\]]*\])),$/m,
      "$1styleUrl: '<component styles>',",
    );
  }
  if (ext === '.scss')
    out = out.replace(
      /@(use|forward|import)\s+'([^']+)'/g,
      (_, kw, p) => `@${kw} '${p.split('/').pop()}'`,
    );
  return out;
}

// Import paths differ by layout (package entry points vs relative paths); the imported symbols must not.
// The import HEADER — leading imports plus the `//` lines between them (the app's `// CDK`-style group
// labels, merge notes about flattened barrels) — is layout by definition and collapses away whole.
function collapseImports(text) {
  // Top-level imports after a file doc comment would sit outside the header: hoist them all first.
  const hoisted = [];
  text = text.replace(/^import\s[^;]*;\n/gm, (stmt) => (hoisted.push(stmt), ''));
  text = hoisted.join('') + text.replace(/\n{3,}/g, '\n\n');
  const lines = text.split('\n');
  let end = 0;
  let inImport = false;
  for (; end < lines.length; end++) {
    const line = lines[end].trim();
    if (inImport) {
      if (line.endsWith(';')) inImport = false;
    } else if (line.startsWith('import ')) {
      inImport = !line.endsWith(';');
    } else if (line !== '' && !line.startsWith('//')) {
      break;
    }
  }

  const header = lines
    .slice(0, end)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  const symbols = new Set();
  for (const [, clause] of header.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'[^']+'/g)) {
    for (const part of clause.replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().replace(/^type\s+/, '');
      if (name) symbols.add(name);
    }
  }
  for (const [, path] of header.matchAll(/import\s+'([^']+)'/g))
    symbols.add(`'${path.split('/').pop()}'`);

  const imports = [...symbols].sort().map((s) => `import ${s}`);
  return `${imports.join('\n')}\n\n${lines.slice(end).join('\n')}`;
}
