/**
 * The prompt document and its stored string, both ways. The grammar itself is
 * `format.ts`; this is where its lines become paragraphs and back.
 */

// 3rd Party
import { Fragment, Node as ProseMirrorNode, Schema } from 'prosemirror-model';

// Editables
import { LineCodec } from '../line/editor';
import { PromptTextLine, PromptLineShape, readPromptLines, writePromptLines } from './format';
import { promptSchema } from './kit';

/** A line's text, a hard break — only ever pasted, never kept — as the newline it stands for. */
const lineText = (line: ProseMirrorNode): string =>
  line.textBetween(0, line.content.size, undefined, '\n');

function toLines(content: Fragment): PromptTextLine[] {
  const lines: PromptTextLine[] = [];
  content.forEach((line) =>
    lines.push({ shape: line.attrs as PromptLineShape, text: lineText(line) }),
  );
  return lines;
}

function toDoc(text: string, schema: Schema, mode: 'stored' | 'pasted'): ProseMirrorNode {
  const paragraph = schema.nodes['paragraph'];
  const lines = readPromptLines(text, mode).map(({ shape, text: content }) =>
    paragraph.create(shape, content ? schema.text(content) : null),
  );
  return schema.topNodeType.create(null, lines);
}

/** The stored prompt as a document — exact: it writes the same string back. */
export function parsePromptText(text: string, schema: Schema = promptSchema): ProseMirrorNode {
  return toDoc(text, schema, 'stored');
}

/** The document as the stored prompt. */
export function serializePromptDoc(doc: ProseMirrorNode): string {
  return writePromptLines(toLines(doc.content));
}

/**
 * A loose fragment — a copy — as lines, or `null` for one that starts and
 * ends inside a line: inline content with no line around it.
 */
export function promptFragmentLines(content: Fragment): PromptTextLine[] | null {
  return content.firstChild?.isInline ? null : toLines(content);
}

/**
 * A loose fragment — a copy. One that starts mid-line is inline content with
 * no line around it, and is just its text.
 */
export function serializePromptFragment(content: Fragment): string {
  if (!content.childCount) return '';
  const lines = promptFragmentLines(content);
  return lines ? writePromptLines(lines) : content.textBetween(0, content.size, undefined, '\n');
}

export const PROMPT_CODEC: LineCodec = {
  parse: parsePromptText,
  parsePasted: (text, schema) => toDoc(text, schema, 'pasted'),
  serialize: serializePromptDoc,
  serializeFragment: serializePromptFragment,
};
