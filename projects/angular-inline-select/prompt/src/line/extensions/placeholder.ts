// 3rd Party
import { Node } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Editables
import { defineExtension, FunctionalExtension } from '../extension';

/** What an empty line says, if anything: its hint, or null. */
export type PlaceholderHint = (state: EditorState, line: Node, pos: number) => string | null;

/**
 * The decorations for a state: the hint on every empty line that has one, as
 * a `data-placeholder` attribute the dialect's stylesheet draws.
 */
export function placeholderDecorations(state: EditorState, hint: PlaceholderHint): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!node.content.size) {
      const said = hint(state, node, pos);
      if (said) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-placeholder': said }));
    }
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * An empty line's hint, as a decoration — never a node attribute, so the
 * document stays what is stored and nothing about the hint is ever
 * serialized. The dialect says which lines say what (`hint`); a line with
 * text says nothing.
 */
export const createPlaceholder = (name: string, key: PluginKey, hint: PlaceholderHint): FunctionalExtension =>
  defineExtension({
    name,
    plugins: () => [
      new Plugin({
        key,
        props: {
          decorations: (state) => placeholderDecorations(state, hint),
        },
      }),
    ],
  });
