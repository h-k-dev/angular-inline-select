// 3rd Party
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Editables
import { defineExtension, FunctionalExtension } from '../extension';
import { LineGrammar } from '../line-node';

export interface HeadingPlaceholderOptions {
  /** The dialect's grammar: which kind is a heading, and how deep a heading is. */
  grammar: Pick<LineGrammar, 'heading' | 'headingDepth'>;
  /**
   * The word before the depth — "Heading" in "Heading 1". Read on every
   * redraw, so a language switch reaches the editor on its next update.
   */
  label: () => string;
}

export const headingPlaceholderKey = new PluginKey<DecorationSet>('headingPlaceholder');

/**
 * The decorations for a state: the hint on every empty heading line, as a
 * `data-placeholder` attribute the shared stylesheet draws (`_lines.scss`).
 */
export function headingPlaceholderDecorations(
  state: EditorState,
  { grammar, label }: HeadingPlaceholderOptions,
): DecorationSet {
  const decorations: Decoration[] = [];
  const word = label();

  state.doc.forEach((line, offset) => {
    if (line.attrs['block'] !== grammar.heading || line.content.size > 0) return;
    const hint = `${word} ${grammar.headingDepth(line.attrs)}`.trim();
    decorations.push(Decoration.node(offset, offset + line.nodeSize, { 'data-placeholder': hint }));
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Notion's empty-heading hint: `# ` turns the line into a title, and until a
 * word is typed the line says what it now is — "Heading 1", "Heading 2" — in
 * the heading's own face, muted. Without it the only sign the marker took is
 * the caret growing a size, which reads as a glitch rather than a title.
 *
 * Decorations rather than a node attribute, so the document stays the stored
 * text and nothing about the hint can ever be serialized.
 */
export const createHeadingPlaceholder = (options: HeadingPlaceholderOptions): FunctionalExtension =>
  defineExtension({
    name: 'headingPlaceholder',
    plugins: () => [
      new Plugin({
        key: headingPlaceholderKey,
        props: {
          decorations: (state) => headingPlaceholderDecorations(state, options),
        },
      }),
    ],
  });
