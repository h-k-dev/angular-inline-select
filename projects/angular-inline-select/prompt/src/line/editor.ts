/**
 * A line editor: a thin, framework-free wrapper over ProseMirror for a
 * document of lines stored as a plain string. Built from the same extension
 * contract as the `angular-email-editor` package so the two can be merged
 * later by deleting this file rather than rewriting a component.
 *
 * The dialect — what a line can be and how the string spells it — comes in as
 * a {@link LineCodec} and the extensions; everything else is shared: the
 * plugin wiring, the paste path, the external-write sync and the memoized
 * read-out.
 */

// 3rd Party
import { Command, EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorProps, EditorView } from 'prosemirror-view';
import { Fragment, Node as ProseMirrorNode, Schema, Slice } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { InputRule, inputRules } from 'prosemirror-inputrules';

// Editables
import { CommandFactory, Extension, ExtensionContext } from './extension';
import { createSchema } from './schema';

/** How a dialect reads and writes its stored string. */
export interface LineCodec {
  /** The stored string as a document — an external write, a restored value. */
  parse(text: string, schema: Schema): ProseMirrorNode;
  /**
   * Text arriving by paste as a document. Defaults to {@link parse}; a dialect
   * whose stored reading is strict on purpose can read a paste leniently.
   */
  parsePasted?(text: string, schema: Schema): ProseMirrorNode;
  /** The document as the stored string. */
  serialize(doc: ProseMirrorNode): string;
  /** A loose fragment — a copy — as the stored string. */
  serializeFragment(content: Fragment): string;
}

/**
 * Builds the slice a paste inserts from the text it amounts to. A single
 * line goes in as text, so it joins the line it lands in; anything with a
 * newline goes in as lines, open at both ends, so the first joins the line
 * before and the last the line after — which is also how a pasted `- item`
 * becomes an item, since the parser reads markers.
 */
export function sliceFromText(text: string, schema: Schema, codec: LineCodec): Slice {
  if (!text.includes('\n')) {
    return new Slice(text ? Fragment.from(schema.text(text)) : Fragment.empty, 0, 0);
  }
  return new Slice((codec.parsePasted ?? codec.parse)(text, schema).content, 1, 1);
}

export interface LineEditorOptions {
  /**
   * The element the view takes over. Passed as ProseMirror's `mount`, so the
   * element keeps the classes and attributes it already carries instead of
   * having a second div appended inside it.
   */
  mount: HTMLElement;
  extensions: Extension[];
  codec: LineCodec;
  /**
   * The schema to build on. Defaults to one built from `extensions`; a dialect
   * that also renders documents without an editor passes its shared instance,
   * since nodes of two schemas never mix.
   */
  schema?: Schema;
  /**
   * A state to resume rather than a fresh one — what a view unmounted earlier
   * left behind, undo history included. It must come from an editor built
   * with the same extensions, since its plugins are the ones it was made with.
   */
  state?: EditorState;
  /** DOM attributes for the editable element. */
  attributes?: Record<string, string>;
  /**
   * When a paste should go in as its `text/plain` flavour rather than as the
   * HTML ProseMirror parsed: when the HTML is this app's own and the plain
   * text is its exact stored string.
   */
  prefersPlainPaste?: (html: string) => boolean;
  /** Further view props — a dialect's clipboard handling. */
  props?: Partial<EditorProps>;
  /** Called after every transaction that changed the document. */
  onUpdate?: (editor: LineEditor) => void;
}

export interface LineEditor {
  view: EditorView;
  schema: Schema;
  readonly state: EditorState;
  /** Named commands from all extensions, bound to the live view. */
  commands: Record<string, (...args: any[]) => boolean>;
  /** Runs a raw ProseMirror command against the current state. */
  exec(command: Command): boolean;
  /** The shape of the line the selection starts on — what a block button reads. */
  activeBlock(): string;
  /** The document as its stored string. */
  getText(): string;
  /** Replaces the document. Never enters the undo history and never fires
      `onUpdate`, so an external write cannot echo back out. Returns whether
      anything changed, so a caller can skip the work that follows a no-op. */
  setText(text: string): boolean;
  isEmpty(): boolean;
  focus(): void;
  destroy(): void;
}

export function createLineEditor(options: LineEditorOptions): LineEditor {
  const { codec } = options;
  const schema = options.state?.schema ?? options.schema ?? createSchema(options.extensions);
  const context: ExtensionContext = { schema, extensions: options.extensions };

  // Extension plugins run before all keymaps, so an interactive plugin can
  // claim a key ahead of the node and mark bindings.
  const extensionPlugins: Plugin[] = [];
  const keymaps: Plugin[] = [];
  const rules: InputRule[] = [];
  const factories: Record<string, CommandFactory> = {};

  for (const extension of options.extensions) {
    if (!options.state) {
      if (extension.plugins) extensionPlugins.push(...extension.plugins(context));
      if (extension.keymap) keymaps.push(keymap(extension.keymap(context)));
      if (extension.inputRules) rules.push(...extension.inputRules(context));
    }
    if (extension.commands) Object.assign(factories, extension.commands(context));
  }

  const plugins: Plugin[] = [...extensionPlugins, ...keymaps];
  if (rules.length) plugins.push(inputRules({ rules }));

  const view: EditorView = new EditorView(
    { mount: options.mount },
    {
      state: options.state ?? EditorState.create({ schema, plugins }),
      attributes: options.attributes,

      // Plain text goes through the same reader as a stored value, so `- item`
      // pasted from a note becomes an item and empty lines stay empty lines —
      // ProseMirror's default would fold the latter away.
      clipboardTextParser: (text) => sliceFromText(text, schema, codec),

      /**
       * Two things ProseMirror's own paste would get wrong here.
       *
       * A paste from this app that carries its exact stored text as
       * `text/plain` goes in as that text — not as the HTML, which any parser
       * can only approximate.
       *
       * And pasting lines into an empty plain line replaces the line instead
       * of joining into it: ProseMirror opens the slice into the line the
       * caret is on, which keeps *that* line's shape, so a pasted list's first
       * item would land as plain text. A paste into the middle of text joins
       * the way it always has.
       */
      handlePaste: (view, event, pasted) => {
        const html = event.clipboardData?.getData('text/html') ?? '';
        const slice = options.prefersPlainPaste?.(html)
          ? sliceFromText(event.clipboardData?.getData('text/plain') ?? '', schema, codec)
          : pasted;
        const ours = slice !== pasted;

        const { $from, empty } = view.state.selection;
        const line = $from.parent;
        const replacesLine =
          empty &&
          slice.openStart === 1 &&
          line.content.size === 0 &&
          line.attrs['block'] === 'paragraph';

        if (!replacesLine && !ours) return false;

        const tr = replacesLine
          ? view.state.tr.replaceWith($from.before(), $from.after(), slice.content)
          : view.state.tr.replaceSelection(slice);
        if (replacesLine) {
          tr.setSelection(TextSelection.create(tr.doc, $from.before() + slice.content.size - 1));
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },

      ...options.props,

      dispatchTransaction(transaction) {
        // Plugins may append transactions of their own, so the document can
        // change even when the dispatched transaction did not. Judging by all
        // of them is what keeps the bound value from falling behind the editor.
        const { state, transactions } = view.state.applyTransaction(transaction);
        view.updateState(state);

        if (
          transactions.some((applied) => applied.docChanged) &&
          !transaction.getMeta('externalSync')
        ) {
          options.onUpdate?.(editor);
        }
      },
    },
  );

  const exec = (command: Command) => command(view.state, view.dispatch, view);

  const commands: LineEditor['commands'] = {};
  for (const [name, factory] of Object.entries(factories)) {
    commands[name] = (...args) => exec(factory(...args));
  }

  // The string of the document last serialized. Documents are immutable, so
  // identity is the whole test. A keystroke reads the string once for the
  // bound value and once more when that value echoes back through `setText`;
  // the second read must not serialize again.
  let serialized: { doc: ProseMirrorNode; text: string } | undefined;
  const getText = (): string => {
    const doc = view.state.doc;
    if (serialized?.doc !== doc) serialized = { doc, text: codec.serialize(doc) };
    return serialized.text;
  };

  const editor: LineEditor = {
    view,
    schema,
    get state() {
      return view.state;
    },
    commands,
    exec,
    activeBlock: () =>
      (view.state.selection.$from.parent.attrs['block'] as string | undefined) ?? 'paragraph',
    getText,
    setText(text) {
      if (getText() === text) return false;

      const doc = codec.parse(text, schema);

      view.dispatch(
        view.state.tr
          .replaceWith(0, view.state.doc.content.size, doc.content)
          // An external change is not the user's to undo, and must not echo
          // back through `onUpdate`.
          .setMeta('addToHistory', false)
          .setMeta('externalSync', true),
      );
      return true;
    },
    // Whitespace alone is empty: a send intent refuses it, and a send button
    // must agree, or it lights up for a message that will not go.
    isEmpty: () => view.state.doc.textContent.trim().length === 0,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };

  return editor;
}
