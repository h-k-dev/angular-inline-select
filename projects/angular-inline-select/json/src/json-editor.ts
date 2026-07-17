import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
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
    keymap.of([...defaultKeymap, ...historyKeymap, ...lintKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacks.onChange(update.state.doc.toString());
    }),
  ];

  return EditorState.create({ doc, extensions });
}
