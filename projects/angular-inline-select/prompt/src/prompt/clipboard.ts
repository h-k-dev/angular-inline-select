// Editables
import { readPromptLines, type PromptTextLine } from './format';

/**
 * A prompt's lines as the HTML every editor reads — what a copy puts on the
 * clipboard beside the Markdown, so a prompt pasted into a chat, a mail or a
 * document keeps what that editor can keep:
 *
 * - a heading is an `<h1>` … `<h6>` by its depth,
 * - consecutive items are one `<ul>` or `<ol>`, the nested level a list of
 *   its own inside the item above it — where every rich editor looks for it —
 *   and a numbered list that does not start at one says so in `start`,
 * - anything else is a `<p>`, an empty line an empty one.
 *
 * The view's own DOM is no use here: an item is a `<p data-block>` whose
 * bullet or number the stylesheet draws, which nothing outside this editor
 * knows how to read.
 *
 * Built with `createElement` and text nodes, never from a markup string: the
 * text is user-authored.
 */
export function promptLinesToDOM(
  lines: readonly PromptTextLine[],
  document: Document,
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // The open top-level list, its last item, and the list nested inside that.
  let list: HTMLElement | null = null;
  let item: HTMLElement | null = null;
  let nested: HTMLElement | null = null;

  const element = (parent: Node, tag: string, text: string): HTMLElement => {
    const created = document.createElement(tag);
    text.split('\n').forEach((part, index) => {
      if (index > 0) created.appendChild(document.createElement('br'));
      if (part) created.appendChild(document.createTextNode(part));
    });
    return parent.appendChild(created);
  };

  const openList = (parent: Node, block: string, first: number | null): HTMLElement => {
    const opened = document.createElement(block === 'number' ? 'ol' : 'ul');
    if (block === 'number' && first !== null && first !== 1)
      opened.setAttribute('start', String(first));
    return parent.appendChild(opened);
  };

  const holds = (open: HTMLElement | null, block: string): open is HTMLElement =>
    open !== null && open.tagName === (block === 'number' ? 'OL' : 'UL');

  for (const { shape, text } of lines) {
    if (shape.block === 'heading' || shape.block === 'paragraph') {
      list = item = nested = null;
      const tag =
        shape.block === 'heading' ? `h${Math.min(Math.max(shape.depth ?? 1, 1), 6)}` : 'p';
      element(fragment, tag, text);
      continue;
    }

    // Nested under the item above — or, with nothing above to nest under, a
    // list of its own at the top: the shape outlives the level.
    if (shape.level > 0 && item) {
      if (!holds(nested, shape.block)) nested = openList(item, shape.block, shape.number);
      element(nested, 'li', text);
      continue;
    }

    if (!holds(list, shape.block)) list = openList(fragment, shape.block, shape.number);
    item = element(list, 'li', text);
    nested = null;
  }

  return fragment;
}

/**
 * Puts a stored prompt on the clipboard the way a copy out of the editor
 * does — the Markdown as `text/plain`, its lines as semantic HTML — so a
 * prompt copied by a button pastes like one selected and copied by hand: a
 * chat keeps its lists, a model or a plain field gets the Markdown.
 *
 * Resolves whether anything was written. Where the rich write is refused
 * (no `ClipboardItem`, or a frame without clipboard-write), the Markdown goes
 * alone; where that is refused too, nothing does.
 */
export async function copyPrompt(text: string, document: Document): Promise<boolean> {
  const clipboard = document.defaultView?.navigator.clipboard;
  if (!clipboard) return false;

  const host = document.createElement('div');
  host.appendChild(promptLinesToDOM(readPromptLines(text), document));

  try {
    await clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([host.innerHTML], { type: 'text/html' }),
      }),
    ]);
    return true;
  } catch {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
