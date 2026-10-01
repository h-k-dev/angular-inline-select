// 3rd Party
import { baseKeymap } from 'prosemirror-commands';

// Editables
import { defineExtension } from '../extension';

/**
 * ProseMirror's default bindings: caret motion, Backspace/Delete joining,
 * Enter splitting a block. Listed last so any extension that wants a key can
 * claim it first — a chat composer's Enter-to-send is the reason this matters.
 */
export const BaseKeymap = defineExtension({
  name: 'baseKeymap',
  keymap: () => baseKeymap,
});
