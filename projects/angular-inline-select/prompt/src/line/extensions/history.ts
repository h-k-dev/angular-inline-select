// 3rd Party
import { history, redo, undo } from 'prosemirror-history';

// Editables
import { defineExtension } from '../extension';

/**
 * Undo history. Not optional: ProseMirror owns the DOM inside the editable, so
 * the browser's native undo has nothing coherent to act on and is disabled.
 */
export const History = defineExtension({
  name: 'history',
  plugins: () => [history()],
  keymap: () => ({
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  }),
});
