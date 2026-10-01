// 3rd Party
import { DOMSerializer } from 'prosemirror-model';

// Editables
import { parsePromptText } from './codec';
import { promptSchema } from './kit';

const serializer = DOMSerializer.fromSchema(promptSchema);

/**
 * Draws a prompt into `host` without an editor: the same lines, from the same
 * schema's `toDOM`, that a view mounted on `host` would draw — so the page can
 * show every prompt at rest and mount a view only on the one being edited.
 * The two must lay out identically, or the row jumps the moment it is
 * engaged; nothing but the schema decides the elements, and nothing but the
 * one stylesheet decides their geometry.
 *
 * One thing the view adds that the schema does not: a line with no text, or
 * one ending in a break, holds a `<br class="ProseMirror-trailingBreak">`, or
 * it would collapse to nothing. Drawn here too, for the same height.
 */
export function renderPrompt(text: string, host: HTMLElement): void {
  const doc = parsePromptText(text);
  const document = host.ownerDocument;
  const fragment = serializer.serializeFragment(doc.content, { document });

  const lines = Array.from(fragment.children);
  doc.forEach((line, _offset, index) => {
    if (line.lastChild?.isText) return;
    const hack = document.createElement('br');
    hack.className = 'ProseMirror-trailingBreak';
    lines[index].appendChild(hack);
  });

  host.replaceChildren(fragment);
}
