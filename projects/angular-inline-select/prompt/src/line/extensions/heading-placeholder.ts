// 3rd Party
import { EditorState, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';

// Editables
import { FunctionalExtension } from '../extension';
import { LineGrammar } from '../line-node';
import { PlaceholderHint, createPlaceholder, placeholderDecorations } from './placeholder';

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

/** What an empty line says: a heading, its kind and depth — "Heading 1"; any other line, nothing. */
const headingHint =
  ({ grammar, label }: HeadingPlaceholderOptions): PlaceholderHint =>
  (_state, line) =>
    line.attrs['block'] === grammar.heading ? `${label()} ${grammar.headingDepth(line.attrs)}`.trim() : null;

/**
 * The decorations for a state: the hint on every empty heading line, as a
 * `data-placeholder` attribute the shared stylesheet draws (`_lines.scss`).
 */
export function headingPlaceholderDecorations(state: EditorState, options: HeadingPlaceholderOptions): DecorationSet {
  return placeholderDecorations(state, headingHint(options));
}

/**
 * Notion's empty-heading hint: `# ` turns the line into a title, and until a
 * word is typed the line says what it now is — "Heading 1", "Heading 2" — in
 * the heading's own face, muted. Without it the only sign the marker took is
 * the caret growing a size, which reads as a glitch rather than a title.
 *
 * The line core's placeholder (`placeholder.ts`), told which lines speak.
 */
export const createHeadingPlaceholder = (options: HeadingPlaceholderOptions): FunctionalExtension =>
  createPlaceholder('headingPlaceholder', headingPlaceholderKey, headingHint(options));
