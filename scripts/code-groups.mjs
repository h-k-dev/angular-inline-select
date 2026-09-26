#!/usr/bin/env node
// The house GROUPING style for Angular source — labelled groups instead of flat lists:
//
//   import { Component, ElementRef,   // Signals  computed, input … } from '@angular/core'
//   import statements                 // Angular · Forms · CDK · Material · ARIA · i18n · 3rd Party · Editables · Datetime
//   @Component({ imports: […] })      // Angular · Forms · CDK · Material · ARIA · i18n · 3rd Party · Components · Directives · Pipes
//   providers: […]                    // Tokens · Services
//   hostDirectives: […]               // Adapters · Directives
//   host: { … }                       // Attributes · Classes · Styles · ARIA · Listeners
//
// Usage:
//   node scripts/code-groups.mjs <files…>           rewrite in place (Prettier-formatted, per-file config)
//   node scripts/code-groups.mjs --check <files…>   exit 1 listing files that are not grouped
//
// Safe by construction: existing group LABELS are replaced, every other comment is carried along,
// and a file is refused (left untouched, reported) if any real comment would go missing.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import prettier from 'prettier';

const args = process.argv.slice(2);
const check = args.includes('--check');
const files = args.filter((a) => !a.startsWith('--'));

// Comments that ARE group labels (any spelling seen in either repo) — replaced, never carried.
const LABELS = new Set(
  [
    'signals', 'signal', 'angular', 'angular cdk', 'angular material', 'angular forms', 'cdk', 'material',
    'forms', 'form', 'aria', 'i18n', '3rd party', 'third party', 'third-party', 'components', 'custom components',
    'directives', 'pipes', 'tokens', 'services', 'api', 'apis', 'adapters', 'attributes', 'classes', 'styles',
    'listeners', 'core', 'editables', 'datetime', 'animation', 'utils', 'lifecycle', 'lifecycle hooks',
  ].map((l) => l.toLowerCase()),
);
const isLabel = (comment) => LABELS.has(comment.replace(/^\/\/\s*/, '').trim().toLowerCase());

const SIGNAL_API = new Set([
  'signal', 'computed', 'linkedSignal', 'effect', 'untracked', 'input', 'model', 'output', 'viewChild',
  'viewChildren', 'contentChild', 'contentChildren', 'afterNextRender', 'afterEveryRender', 'afterRenderEffect',
  'resource', 'Signal', 'WritableSignal', 'InputSignal', 'ModelSignal', 'OutputEmitterRef',
]);

const IMPORT_GROUPS = ['Angular', 'Forms', 'CDK', 'Material', 'ARIA', 'i18n', '3rd Party', 'Editables', 'Datetime'];
const DECORATOR_IMPORT_GROUPS = ['Angular', 'Forms', 'CDK', 'Material', 'ARIA', 'i18n', '3rd Party', 'Components', 'Directives', 'Pipes'];
const HOST_GROUPS = ['Attributes', 'Classes', 'Styles', 'ARIA', 'Listeners'];

/** Which import-statement group a module belongs to. */
function moduleGroup(spec, fromFile) {
  if (/^@angular\/(core|common|router|platform-browser|animations)/.test(spec)) return 'Angular';
  if (spec.startsWith('@angular/forms')) return 'Forms';
  if (spec.startsWith('@angular/cdk')) return 'CDK';
  if (spec.startsWith('@angular/material')) return 'Material';
  if (spec.startsWith('@angular/aria')) return 'ARIA';
  if (spec.startsWith('@ngx-translate')) return 'i18n';
  if (!spec.startsWith('.') && !spec.startsWith('angular-inline-select')) return '3rd Party';
  const target = spec.startsWith('.') ? resolve(dirname(fromFile), spec) : spec;
  if (/\/translations\//.test(target)) return 'i18n';
  if (/\/datetime\//.test(target + '/')) return 'Datetime';
  return 'Editables';
}

// -- The declaration kind of every class a decorator `imports` array can name ---------------------
const KIND = new Map();
function learnKinds(text) {
  const re = /@(Component|Directive|Pipe)\s*\(\s*\{[\s\S]*?\}\s*\)\s*export\s+(?:abstract\s+)?class\s+(\w+)/g;
  for (const m of text.matchAll(re)) KIND.set(m[2], m[1]);
}

// -- Rendering helpers --------------------------------------------------------------------------------

/** A node's text with its attached comments (labels dropped); `comments` collects every real comment seen. */
function withComments(node, sf, source, seen) {
  const kept = [];
  for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
    const c = source.slice(range.pos, range.end);
    if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia && isLabel(c)) continue;
    kept.push(c);
    seen.push(c);
  }
  return [...kept, node.getText(sf)].join('\n');
}

/** Comments sitting between the last element and the closing bracket. */
function tailComments(listEnd, closePos, source, seen) {
  const out = [];
  const between = source.slice(listEnd, closePos);
  for (const m of between.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
    if (m[0].startsWith('//') && isLabel(m[0])) continue;
    out.push(m[0]);
    seen.push(m[0]);
  }
  return out;
}

function renderGroups(order, groups, sep = ',') {
  const blocks = order
    .filter((g) => groups.get(g)?.length)
    .map((g) => [`// ${g}`, ...groups.get(g).map((e) => e + sep)].join('\n'));
  return blocks.join('\n\n');
}

// -- The file pass -------------------------------------------------------------------------------------

function groupFile(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  const seen = [];

  // 1. The import header: statements into labelled groups; `@angular/core` split into plain + Signals.
  const imports = [];
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) imports.push(st);
    else break;
  }
  const origin = new Map();
  if (imports.length) {
    const groups = new Map();
    for (const decl of imports) {
      const spec = decl.moduleSpecifier.text;
      const group = moduleGroup(spec, file);
      for (const el of decl.importClause?.namedBindings?.elements ?? []) origin.set(el.name.text, spec);
      if (decl.importClause?.name) origin.set(decl.importClause.name.text, spec);

      // The first import's leading comments are the file header — they stay on top (see `pre`).
      let text = decl === imports[0] ? decl.getText(sf) : withComments(decl, sf, source, seen);
      if (spec === '@angular/core' && decl.importClause?.namedBindings && ts.isNamedImports(decl.importClause.namedBindings)) {
        const inner = decl.importClause.namedBindings;
        const els = inner.elements.map((el) => ({ name: el.name.text, text: el.getText(sf) }));
        const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
        const plain = els.filter((e) => !SIGNAL_API.has(e.name)).sort(byName);
        const signals = els.filter((e) => SIGNAL_API.has(e.name)).sort(byName);
        // comments inside the braces other than labels would be dropped — refuse below if any exist
        for (const m of inner.getText(sf).matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) if (!isLabel(m[0])) seen.push(m[0]);
        const typeOnly = decl.importClause.isTypeOnly ? 'type ' : '';
        const body = [
          ...plain.map((e) => `  ${e.text},`),
          ...(signals.length ? [...(plain.length ? [''] : []), '  // Signals', ...signals.map((e) => `  ${e.text},`)] : []),
        ].join('\n');
        const lead = text.slice(0, text.length - decl.getText(sf).length);
        text = `${lead}import ${typeOnly}{\n${body}\n} from '@angular/core';`;
      }
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(text);
    }
    const start = imports[0].getFullStart();
    // keep what precedes the first import (a file header) minus label comments
    const pre = source.slice(start, imports[0].getStart(sf));
    const preKept = pre
      .split('\n')
      .filter((line) => !(line.trim().startsWith('//') && isLabel(line.trim())))
      .join('\n')
      .replace(/\s+$/, '');
    const header = IMPORT_GROUPS.filter((g) => groups.get(g)?.length)
      .map((g) => [`// ${g}`, ...groups.get(g)].join('\n'))
      .join('\n\n');
    edits.push({ start, end: imports.at(-1).getEnd(), text: (preKept ? preKept + '\n\n' : '') + header });
  }

  // 2. Decorator metadata of every @Component / @Directive.
  const visit = (node) => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression.getText(sf);
      const arg = node.expression.arguments[0];
      if ((callee === 'Component' || callee === 'Directive') && arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name.getText(sf);
          const init = prop.initializer;
          if (ts.isArrayLiteralExpression(init) && ['imports', 'providers', 'hostDirectives'].includes(key)) {
            edits.push(arrayEdit(key, init));
          } else if (key === 'host' && ts.isObjectLiteralExpression(init)) {
            edits.push(hostEdit(init));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  function arrayEdit(key, arr) {
    const groups = new Map();
    for (const el of arr.elements) {
      const name = ts.isIdentifier(el) ? el.text : ts.isObjectLiteralExpression(el) ? objDirectiveName(el) : '';
      let g;
      if (key === 'providers') g = ts.isIdentifier(el) ? 'Services' : 'Tokens';
      else if (key === 'hostDirectives') g = /FormField|Adapter/.test(name) ? 'Adapters' : 'Directives';
      else {
        const spec = origin.get(name);
        const mg = spec ? moduleGroup(spec, file) : 'Editables';
        if (mg !== 'Editables' && mg !== 'Datetime') g = mg;
        else g = KIND.get(name) === 'Pipe' || /Pipe$/.test(name) ? 'Pipes' : KIND.get(name) === 'Directive' ? 'Directives' : 'Components';
      }
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(withComments(el, sf, source, seen));
    }
    const tail = tailComments(arr.elements.at(-1)?.getEnd() ?? arr.getStart(sf) + 1, arr.getEnd() - 1, source, seen);
    const order = key === 'providers' ? ['Tokens', 'Services'] : key === 'hostDirectives' ? ['Adapters', 'Directives'] : DECORATOR_IMPORT_GROUPS;
    const body = renderGroups(order, groups) + (tail.length ? '\n' + tail.join('\n') : '');
    return { start: arr.getStart(sf), end: arr.getEnd(), text: arr.elements.length ? `[\n${body}\n]` : '[]' };
  }

  function objDirectiveName(obj) {
    const d = obj.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'directive');
    return d ? d.initializer.getText(sf) : '';
  }

  function hostEdit(obj) {
    const groups = new Map();
    for (const p of obj.properties) {
      const raw = ts.isPropertyAssignment(p) ? p.name.getText(sf).replace(/^['"]|['"]$/g, '') : '';
      const g = raw.startsWith('(')
        ? 'Listeners'
        : /^\[attr\.aria-|^aria-/.test(raw)
          ? 'ARIA'
          : /^\[class[.\]]/.test(raw)
            ? 'Classes'
            : /^\[style[.\]]/.test(raw)
              ? 'Styles'
              : 'Attributes';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(withComments(p, sf, source, seen));
    }
    const tail = tailComments(obj.properties.at(-1)?.getEnd() ?? obj.getStart(sf) + 1, obj.getEnd() - 1, source, seen);
    const body = renderGroups(HOST_GROUPS, groups) + (tail.length ? '\n' + tail.join('\n') : '');
    return { start: obj.getStart(sf), end: obj.getEnd(), text: obj.properties.length ? `{\n${body}\n}` : '{}' };
  }

  visit(sf);

  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // Safety net: every real comment of the original must survive.
  const missing = [...new Set(seen)].filter((c) => !out.includes(c));
  return { out, missing };
}

// -- Main ----------------------------------------------------------------------------------------------

for (const f of files) learnKinds(readFileSync(f, 'utf8'));
// Classes named in `imports` arrays but declared elsewhere: learn their kind from these roots too.
const { globSync } = await import('node:fs');
for (const root of process.env.CODE_GROUPS_KIND_ROOTS?.split(':').filter(Boolean) ?? []) {
  for (const g of globSync(`${root}/**/*.ts`)) if (!g.endsWith('.spec.ts')) learnKinds(readFileSync(g, 'utf8'));
}

let bad = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const { out, missing } = groupFile(file, source);
  if (missing.length) {
    console.error(`REFUSED ${file} — would lose comments:\n  ${missing.join('\n  ')}`);
    bad++;
    continue;
  }
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(out, { ...options, filepath: file });
  const current = await prettier.format(source, { ...options, filepath: file });
  if (formatted === current) continue;
  if (check) {
    console.log(`not grouped: ${file}`);
    bad++;
  } else {
    writeFileSync(file, formatted);
    console.log(`grouped ${file}`);
  }
}
process.exit(bad ? 1 : 0);
