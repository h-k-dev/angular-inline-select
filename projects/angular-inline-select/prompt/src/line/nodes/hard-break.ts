// Editables
import { defineNode } from '../extension';

/**
 * A `<br>` in pasted HTML, and nothing more. A line editor's own line is the
 * line node — Enter or Shift-Enter splits one — so no hard break is ever
 * typed, and the paste handler in `editor.ts` rewrites any that were pasted
 * into lines. The node exists so the parser has somewhere to put a `<br>` on
 * the way there; without it the parser drops the break and joins the two
 * lines.
 */
export const HardBreak = defineNode({
  name: 'hardBreak',
  spec: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
});
