/**
 * Pure helpers for the display → overlay editor handoff:
 * mapping between plain-text offsets and DOM selections, and replaying the
 * intercepted first edit onto the committed text.
 *
 * Text offsets (not DOM ranges) are the transfer currency because the display
 * element and the overlay editor are different DOM trees.
 */

export interface SelectionOffsets {
  start: number;
  end: number;
}

export interface ReplayedEdit {
  /** The draft text after applying the intercepted edit. */
  text: string;
  /** The caret offset within the draft text. */
  caret: number;
}

/**
 * Reads the current selection inside `root` as plain-text offsets.
 * Returns `null` when the selection lives outside of `root`.
 */
export function getSelectionOffsets(root: HTMLElement): SelectionOffsets | null {
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const probe = doc.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  const start = probe.toString().length;

  probe.setEnd(range.endContainer, range.endOffset);
  const end = probe.toString().length;

  return { start, end: Math.max(start, end) };
}

/**
 * Places a collapsed caret at `offset` (plain-text) inside `root`.
 * Offsets past the end clamp to the end of the content.
 */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;

  let remaining = Math.max(0, offset);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let target: Text | null = null;
  let targetOffset = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (remaining <= text.data.length) {
      target = text;
      targetOffset = remaining;
      break;
    }
    remaining -= text.data.length;
  }

  const range = doc.createRange();
  if (target) {
    range.setStart(target, targetOffset);
  } else {
    // Offset beyond content (or empty root) — caret at the very end.
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Applies the intent of an intercepted `beforeinput` event onto `text`.
 * Covers the edits a pristine field can receive from the keyboard; anything
 * exotic returns `null`, which elevates without modifying the draft.
 */
export function replayEdit(
  text: string,
  { start, end }: SelectionOffsets,
  event: Pick<InputEvent, 'inputType' | 'data'>,
  singleLine: boolean,
): ReplayedEdit | null {
  const insert = (chunk: string): ReplayedEdit => ({
    text: text.slice(0, start) + chunk + text.slice(end),
    caret: start + chunk.length,
  });

  switch (event.inputType) {
    case 'insertText':
      return event.data ? insert(event.data) : null;

    case 'insertLineBreak':
    case 'insertParagraph':
      return singleLine ? null : insert('\n');

    case 'deleteContentBackward': {
      if (start !== end) return { text: text.slice(0, start) + text.slice(end), caret: start };
      if (start === 0) return null;
      return { text: text.slice(0, start - 1) + text.slice(start), caret: start - 1 };
    }

    case 'deleteContentForward': {
      if (start !== end) return { text: text.slice(0, start) + text.slice(end), caret: start };
      if (end >= text.length) return null;
      return { text: text.slice(0, start) + text.slice(end + 1), caret: start };
    }

    default:
      return null;
  }
}

export interface FilteredText {
  /** The text with rejected characters removed. */
  text: string;
  /** The caret offset, shifted left by the rejections that fell before it. */
  caret: number;
}

/**
 * Drops every character `allow` rejects, keeping the caret anchored to the
 * text that survives.
 *
 * A per-character predicate (rather than a free string → string transform) is
 * what makes the caret math exact: the rejected indices are known, so the
 * caret shifts by exactly the count of rejections *before* it. A free
 * transform could only diff before/after and guess, which is what produces
 * caret jumps.
 *
 * This filters, it does not validate: `[0-9.]` still admits `1.2.3`.
 *
 * Offsets are UTF-16 code units, matching DOM selection offsets. A predicate
 * that admitted astral characters would split their surrogate pairs — a
 * non-issue for the numeric/ASCII classes this exists for.
 *
 * `allow` may carry any flags: the stateful ones are normalized away here
 * rather than trusted to the caller, since `test()` on a `g`/`y` regex
 * advances `lastIndex` and would reject every other character.
 */
export function filterChars(text: string, caret: number, allow: RegExp): FilteredText {
  const test =
    allow.global || allow.sticky
      ? new RegExp(allow.source, allow.flags.replace(/[gy]/g, ''))
      : allow;

  let out = '';
  let shift = 0;

  for (let i = 0; i < text.length; i++) {
    if (test.test(text[i])) out += text[i];
    else if (i < caret) shift++;
  }

  return { text: out, caret: caret - shift };
}
