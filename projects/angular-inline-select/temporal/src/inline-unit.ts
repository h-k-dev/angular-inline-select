/**
 * THE INTERACTIVE UNIT for the input-hosted family (date, time, duration):
 * the wrapper around the real `<input>`s is the box the pointer meets — its
 * shape (the `unit` mixin in `_inline-unit.scss`) arms the bubbles and
 * paints, and a press on the wrapper's own space lands in the NEAREST
 * input. The text family does the same on its contenteditable
 * (`caretOffsetNearPoint`); inputs have no hit-testing API for a caret, so
 * the landing is the nearest input and a caret at the nearest edge, or
 * proportional to the point inside the input's box (digits are close to
 * monospace, which is what these inputs hold).
 */

const INTERACTIVE_SELECTOR = 'input, button, a, select, textarea, [role="button"]';

/**
 * Whether a press lands on the unit's OWN space: a plain left press, no
 * shift (a shift-press extends a selection natively), not on an input (the
 * browser places that caret) and not on chrome inside the unit (the 📅
 * trigger, a phone flag) — those keep their own handling.
 */
export function isUnitSpacePress(event: MouseEvent, unit: HTMLElement): boolean {
  if (event.button !== 0 || event.shiftKey) return false;

  const target = event.target as Element | null;
  if (target === null) return false;

  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive === null || !unit.contains(interactive);
}

/** Manhattan distance from a point to a rect's edge — zero inside it. */
function distanceTo(rect: DOMRect, x: number, y: number): number {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return dx + dy;
}

/**
 * Focuses the enabled input nearest to a viewport point and lands its caret
 * near the point: before the input's box → the start, past it → the end,
 * inside it → proportional. Without layout (jsdom) the first input takes
 * it, caret at the end. Returns the input focused, or null when none can be.
 */
export function focusInputNearPoint(
  inputs: readonly (HTMLInputElement | undefined)[],
  x: number,
  y: number,
): HTMLInputElement | null {
  const candidates = inputs.filter(
    (input): input is HTMLInputElement => input !== undefined && !input.disabled,
  );
  if (candidates.length === 0) return null;

  let nearest = candidates[0];
  let best = Infinity;
  for (const input of candidates) {
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const distance = distanceTo(rect, x, y);
    if (distance < best) {
      best = distance;
      nearest = input;
    }
  }

  nearest.focus();

  const rect = nearest.getBoundingClientRect();
  const length = nearest.value.length;
  const offset =
    rect.width === 0
      ? length
      : x <= rect.left
        ? 0
        : x >= rect.right
          ? length
          : Math.round(((x - rect.left) / rect.width) * length);

  try {
    nearest.setSelectionRange(offset, offset);
  } catch {
    // `type="time"` and friends refuse selection ranges — focus is enough.
  }

  return nearest;
}
