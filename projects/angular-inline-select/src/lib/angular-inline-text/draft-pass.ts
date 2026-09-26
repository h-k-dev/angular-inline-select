// Editables
import { filterChars } from './caret';

/**
 * Whether the platform supports `contenteditable="plaintext-only"`. When it
 * does not (SSR, older Firefox) the editor falls back to `"true"` plus manual
 * paste sanitization (`insertPlainText`).
 */
export const SUPPORTS_PLAINTEXT_ONLY = (() => {
  if (typeof document === 'undefined') return false;

  const probe = document.createElement('div');
  try {
    probe.contentEditable = 'plaintext-only';
    return probe.contentEditable === 'plaintext-only';
  } catch {
    return false;
  }
})();

/**
 * The per-character filter an `allowedChars` regex compiles to — its stateful
 * flags (`g`, `y`) stripped ONCE, so the keystroke hot path allocates nothing.
 */
export function compileCharFilter(allow: RegExp | undefined): RegExp | null {
  if (!allow) return null;
  return allow.global || allow.sticky
    ? new RegExp(allow.source, allow.flags.replace(/[gy]/g, ''))
    : allow;
}

/** A draft after the editor pass, with the caret carried along. */
export interface DraftPass {
  text: string;
  caret: number;
  /** Whether the pass changed the text — the editor DOM then needs rewriting. */
  rewritten: boolean;
}

/**
 * The editor pass every input goes through: an "empty" editable's lone line
 * break reads as empty, a single-line field's breaks collapse to spaces, and
 * the character filter drops what it rejects — the caret follows each rewrite.
 */
export function passDraft(
  raw: string,
  caret: number | undefined,
  options: { singleLine: boolean; filter: RegExp | null },
): DraftPass {
  let text = raw === '\n' ? '' : raw;
  let at = caret ?? text.length;
  let rewritten = false;

  if (options.singleLine && text.includes('\n')) {
    text = text.replace(/\n+/g, ' ');
    at = Math.min(at, text.length);
    rewritten = true;
  }

  if (options.filter) {
    const filtered = filterChars(text, at, options.filter);
    if (filtered.text !== text) {
      ({ text, caret: at } = filtered);
      rewritten = true;
    }
  }

  return { text, caret: at, rewritten };
}

/**
 * The paste fallback where `plaintext-only` is unsupported: inserts the text
 * as plain text (never HTML) at the caret, collapsing the caret after it — or
 * appends when there is no usable caret inside the editor.
 */
export function insertPlainText(editor: HTMLElement, text: string): void {
  const selection = editor.ownerDocument.defaultView?.getSelection();

  if (
    !selection ||
    selection.rangeCount === 0 ||
    !editor.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    editor.textContent = (editor.innerText ?? editor.textContent ?? '') + text;
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const node = editor.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
