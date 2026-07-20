import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';

import { parseJsonDraft } from './json-codec';
import { printEditableJson } from './json-doc';

// -----------------------------------------------------------------------------
// Tokenizer — hand-rolled for EXACTLY our dialect (strict JSON + bare
// identifier keys). The Lezer JSON grammar mis-parses bare keys (error
// recovery re-tags neighbors — values steal the key color, keys go plain),
// so highlighting around them never read as JSON. A stream tokenizer with an
// object/array stack classifies every token deterministically instead.
// -----------------------------------------------------------------------------

interface JsonStreamState {
  /** Open containers, innermost last. */
  stack: string[];
}

const jsonStreamParser: StreamParser<JsonStreamState> = {
  name: 'json',

  startState: () => ({ stack: [] }),
  copyState: (state) => ({ stack: state.stack.slice() }),

  token(stream, state) {
    if (stream.eatSpace()) return null;

    const inObject = state.stack[state.stack.length - 1] === '{';

    // Strings — a key when inside an object and a colon follows.
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
      return inObject && stream.match(/^\s*:/, false) ? 'propertyName' : 'string';
    }

    if (stream.match(/^-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^(?:true|false)\b/)) return 'bool';
    if (stream.match(/^null\b/)) return 'null';

    // Bare identifiers: a KEY in key position (the one leniency), an error anywhere else.
    if (stream.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)) {
      return inObject && stream.match(/^\s*:/, false) ? 'propertyName' : 'invalid';
    }

    const ch = stream.next();
    switch (ch) {
      case '{':
      case '[':
        state.stack.push(ch);
        return ch === '{' ? 'brace' : 'squareBracket';
      case '}':
      case ']':
        state.stack.pop();
        return ch === '}' ? 'brace' : 'squareBracket';
      case ':':
      case ',':
        return 'punctuation';
      default:
        return 'invalid';
    }
  },

  indent(state, textAfter, context) {
    const closing = /^[}\]]/.test(textAfter);
    return (state.stack.length - (closing ? 1 : 0)) * context.unit;
  },

  languageData: {
    indentOnInput: /^\s*[}\]]$/,
  },
};

const jsonLanguage = StreamLanguage.define(jsonStreamParser);

/**
 * GitHub syntax colors, BOTH schemes: `light-dark(primer-light, primer-dark)`
 * follows the app's `color-scheme` automatically, and every color remains
 * overridable via its `--editable-json-syntax-*` token. GitHub renders JSON
 * constants (numbers, booleans, null) in the same accent as keys — that
 * near-monochrome blue/navy split IS the GitHub JSON look.
 */
const githubJsonHighlight = HighlightStyle.define([
  {
    tag: tags.propertyName,
    color: 'var(--editable-json-syntax-property, light-dark(#0550ae, #79c0ff))',
  },
  { tag: tags.string, color: 'var(--editable-json-syntax-string, light-dark(#0a3069, #a5d6ff))' },
  { tag: tags.number, color: 'var(--editable-json-syntax-number, light-dark(#0550ae, #79c0ff))' },
  {
    tag: [tags.bool, tags.null],
    color: 'var(--editable-json-syntax-keyword, light-dark(#0550ae, #79c0ff))',
  },
  {
    tag: tags.invalid,
    color: 'var(--editable-json-syntax-invalid, light-dark(#82071e, #ffa198))',
  },
]);

/**
 * The commit gate as a live diagnostic: reruns the exact same parse the
 * commit path uses (bare-key leniency, otherwise strict), so bare keys are
 * never flagged while a trailing comma — or any other real syntax error —
 * surfaces while typing. One parser, one verdict.
 */
const jsonLinter = linter((view) => {
  const text = view.state.doc.toString();
  const parsed = parseJsonDraft(text);
  if (parsed.error === undefined) return [];

  const diagnostic: Diagnostic = { from: 0, to: text.length, severity: 'error', message: parsed.error };
  return [diagnostic];
});

// -----------------------------------------------------------------------------
// Indent guides — faint vertical rules under each indentation level, so nesting
// reads at a glance. Our editing form is space-indented two per level
// (`printEditableJson`), and the dialect is space-only, so counting leading
// spaces is exact. Each indented line carries a `--cm-indent-levels` custom
// property; the CSS (_editable-json.scss) draws that many evenly-spaced rules
// with a clipped repeating gradient. One decoration object per level is cached.
// -----------------------------------------------------------------------------

const INDENT_COLUMNS = 2;

const indentGuideDecorations = new Map<number, Decoration>();

function indentGuideDecoration(levels: number): Decoration {
  let deco = indentGuideDecorations.get(levels);
  if (deco === undefined) {
    deco = Decoration.line({
      attributes: { class: 'cm-indentGuides', style: `--cm-indent-levels:${levels}` },
    });
    indentGuideDecorations.set(levels, deco);
  }
  return deco;
}

function buildIndentGuides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;

      let spaces = 0;
      while (spaces < text.length && text.charCodeAt(spaces) === 32) spaces++;

      const levels = Math.floor(spaces / INDENT_COLUMNS);
      if (levels > 0) builder.add(line.from, line.from, indentGuideDecoration(levels));

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildIndentGuides(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildIndentGuides(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// -----------------------------------------------------------------------------
// Format — "prettier", but for OUR dialect. Real Prettier would re-quote the
// bare identifier keys we deliberately allow; instead we round-trip through the
// same `printEditableJson` that seeds a session (pretty, two-space, bare keys).
// -----------------------------------------------------------------------------

/**
 * The formatted (editing-form) rendering of `text` IF it both parses and
 * differs from it — otherwise `null`. `null` is the "nothing to do" verdict
 * shared by every caller: an unparseable/empty draft, or one already in pretty
 * form. Computed once so the reformat and the "can format?" badge never
 * disagree.
 */
function pendingFormat(text: string): string | null {
  const parsed = parseJsonDraft(text);
  if (parsed.error !== undefined || parsed.value === undefined) return null;

  const formatted = printEditableJson(parsed.value);
  return formatted === text ? null : formatted;
}

/**
 * Whether a reformat would change anything right now — drives the red-dot badge
 * on the Format control. False for empty, invalid, and already-pretty drafts,
 * so the badge means exactly "clicking Format will do something".
 */
export function canFormatJson(text: string): boolean {
  return pendingFormat(text) !== null;
}

/**
 * Reflow the whole document into the editing form when it currently parses.
 * Idempotent — already-pretty text is left untouched, so a no-op never adds a
 * history entry or jumps the caret; an unparseable (or empty) draft is a no-op
 * too, the lint diagnostic already explaining why. The caret is clamped to the
 * reflowed length rather than mapped: a total reformat has no position map.
 * Returns whether anything changed. Shared by the button, the shortcut, and the
 * paste handler below.
 */
export function formatJsonDoc(view: EditorView): boolean {
  const text = view.state.doc.toString();

  const formatted = pendingFormat(text);
  if (formatted === null) return false;

  view.dispatch({
    changes: { from: 0, to: text.length, insert: formatted },
    selection: { anchor: Math.min(view.state.selection.main.anchor, formatted.length) },
    userEvent: 'format',
  });
  return true;
}

export interface JsonEditorCallbacks {
  onChange: (text: string) => void;
}

export interface JsonEditorOptions {
  /**
   * Whether the surrounding theme is DARK. CodeMirror cannot see the app's
   * `color-scheme` — its injected base theme defaults to light (black
   * caret, white tooltips: invisible/unreadable on a dark surface). This
   * flag switches CM's own `&dark` base theme wholesale, so caret,
   * tooltips, selection and panels all follow — no per-selector overrides.
   */
  dark?: boolean;
}

/**
 * The elevated editing surface's extensions: line numbers, GitHub-flavored
 * highlighting over our own tokenizer, bracket matching, auto-indent, and
 * the strict lint diagnostic above.
 */
export function createJsonEditorState(
  doc: string,
  callbacks: JsonEditorCallbacks,
  options: JsonEditorOptions = {},
): EditorState {
  const extensions: Extension[] = [
    jsonLanguage,
    lineNumbers(),
    indentGuides,
    // An (empty) theme whose only job is declaring the scheme — flips every
    // `&dark` rule in CM's base theme.
    EditorView.theme({}, { dark: options.dark ?? false }),
    syntaxHighlighting(githubJsonHighlight),
    bracketMatching(),
    indentOnInput(),
    history(),
    EditorView.lineWrapping,
    jsonLinter,
    lintGutter(),
    // Format Document — VS Code's shortcut. First in the list so it wins the
    // chord; always consumes it (never falls through to type an 'F').
    keymap.of([
      {
        key: 'Shift-Alt-f',
        run: (view) => {
          formatJsonDoc(view);
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    // Format-on-paste: let the paste apply, then tidy the whole document if it
    // now parses (a pasted fragment that doesn't is left as-is). The reformat
    // runs a microtask later — after CM has committed the paste transaction —
    // so it operates on the pasted text, not the pre-paste doc.
    EditorView.domEventHandlers({
      paste: (_event, view) => {
        queueMicrotask(() => formatJsonDoc(view));
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacks.onChange(update.state.doc.toString());
    }),
  ];

  return EditorState.create({ doc, extensions });
}
