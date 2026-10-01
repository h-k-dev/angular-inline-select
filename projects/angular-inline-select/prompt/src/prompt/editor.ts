/**
 * The prompt editor: the shared line editor (`line/editor.ts`) with the prompt
 * format and its clipboard.
 */

// 3rd Party
import { Schema, Slice } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';

// Editables
import { Extension } from '../line/extension';
import { createLineEditor, LineEditor, sliceFromText } from '../line/editor';
import { PROMPT_CODEC, serializePromptFragment } from './codec';
import { promptSchema } from './kit';

/**
 * Rewrites a pasted slice into the prompt's own shape. ProseMirror has already
 * parsed the clipboard HTML against the schema — a heading from a web page as
 * a heading line, a list item as an item, a `<br>` as a hard break — and the
 * serializer writes that out as Markdown, which is then read back the way
 * pasted text is: leniently, counted from where it lands, breaks as lines.
 * One path, whatever the source.
 */
function normalizePasted(slice: Slice, schema: Schema): Slice {
  return sliceFromText(serializePromptFragment(slice.content), schema, PROMPT_CODEC);
}

export interface PromptEditorOptions {
  /** The element the view takes over — the one the static copy was drawn in. */
  mount: HTMLElement;
  extensions: Extension[];
  /** A state an earlier view of this prompt left behind, to resume with its undo history. */
  state?: EditorState;
  /** Called after every transaction that changed the document. */
  onUpdate?: (editor: LineEditor) => void;
}

export function createPromptEditor(options: PromptEditorOptions): LineEditor {
  return createLineEditor({
    mount: options.mount,
    extensions: options.extensions,
    schema: promptSchema,
    state: options.state,
    codec: PROMPT_CODEC,
    onUpdate: options.onUpdate,
    props: {
      // `text/plain` is the prompt as stored, Markdown; `text/html` is the
      // lines as drawn, which a prompt editor reads back exactly.
      clipboardTextSerializer: (slice) => serializePromptFragment(slice.content),
      transformPasted: (slice, view) => normalizePasted(slice, view.state.schema),
    },
  });
}
