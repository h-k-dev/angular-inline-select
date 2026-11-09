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
 * Scrolls `scroller` so the caret's line shows: centred when it was out of
 * view, untouched when it already shows. Placing a selection never scrolls on
 * its own, so a caret set deep in a long draft would sit far below the part of
 * the editor the user can see.
 */
export function revealCaret(scroller: HTMLElement): void {
  const selection = scroller.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return;

  const caret = caretRect(selection.getRangeAt(0));
  if (!caret) return;

  const view = scroller.getBoundingClientRect();
  if (caret.top >= view.top && caret.bottom <= view.bottom) return;

  // A jump, never an animation: under `scroll-behavior: smooth` a draft tens of
  // thousands of pixels long would race past before the caret arrives.
  const top =
    scroller.scrollTop + caret.top - view.top - (scroller.clientHeight - caret.height) / 2;
  if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'instant' });
  else scroller.scrollTop = top;
}

/**
 * The collapsed range's box. Right after a line break a collapsed range can
 * measure empty (no layout, or jsdom: no measuring at all), so the character
 * after it stands in for the line.
 */
function caretRect(range: Range): DOMRect | null {
  if (typeof range.getBoundingClientRect !== 'function') return null;

  const box = range.getBoundingClientRect();
  if (box.height > 0) return box;

  const { startContainer: node, startOffset: offset } = range;
  if (node.nodeType !== Node.TEXT_NODE || offset >= (node as Text).length) return null;

  const next = node.ownerDocument!.createRange();
  next.setStart(node, offset);
  next.setEnd(node, offset + 1);

  const line = next.getBoundingClientRect();
  return line.height > 0 ? line : null;
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

/**
 * Carries a caret from one rendering of a value to another: `draft` is
 * `source` with characters removed (a grouped number and its plain form —
 * `1.250.000,50` → `1250000,5`). Walks both in step, so the caret lands
 * after the same characters it followed in the source. Characters the draft
 * lacks are skipped; a caret past the draft's end clamps to it.
 *
 * The one ADDING rendering: a draft that is `source` behind a lead (a phone's
 * dial prefix, `+49 30 1` → `#0 +49 30 1`) shifts the caret past the lead.
 */
export function alignCaret(source: string, draft: string, caret: number): number {
  if (draft.length > source.length && draft.endsWith(source)) {
    return draft.length - source.length + Math.min(caret, source.length);
  }

  let j = 0;
  const end = Math.min(caret, source.length);

  for (let i = 0; i < end && j < draft.length; i++) {
    if (source[i] === draft[j]) j++;
  }

  return j;
}

/** A text position resolved by the browser's own hit-testing (two API generations). */
function hitTextPosition(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };

  if (typeof d.caretPositionFromPoint === 'function') {
    const position = d.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === 'function') {
    const range = d.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }

  return null;
}

/**
 * The text offset in `root` nearest to a viewport point OUTSIDE its text — a
 * press in the field's halo. What a native input does with a press in its
 * padding: the caret lands on the closest character of the closest line,
 * never wherever the browser would have started a selection in the wrapper.
 * The point is clamped INTO the nearest line box and resolved through the
 * browser's hit-testing; without layout or the API (jsdom) it falls back to
 * the nearest edge — the start when the press sits before the first line,
 * the end otherwise.
 */
export function caretOffsetNearPoint(root: HTMLElement, x: number, y: number): number {
  const length = root.textContent?.length ?? 0;
  const rects = Array.from(root.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (rects.length === 0) return length;

  // The closest line box vertically (a tie keeps the earlier line).
  let line = rects[0];
  let best = Infinity;
  for (const rect of rects) {
    const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (distance < best) {
      best = distance;
      line = rect;
    }
  }

  const clampedX = Math.min(Math.max(x, line.left + 1), line.right - 1);
  const clampedY = line.top + line.height / 2;

  const doc = root.ownerDocument;
  const hit = hitTextPosition(doc, clampedX, clampedY);
  if (hit && root.contains(hit.node)) {
    const probe = doc.createRange();
    probe.selectNodeContents(root);
    probe.setEnd(hit.node, hit.offset);
    return probe.toString().length;
  }

  return line === rects[0] && x < line.left ? 0 : length;
}
