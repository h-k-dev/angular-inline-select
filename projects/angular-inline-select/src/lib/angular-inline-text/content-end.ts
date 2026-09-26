// Angular
import {
  DestroyRef,
  inject,

  // Signals
  afterNextRender,
  afterRenderEffect,
  signal,
  type Signal,
} from '@angular/core';

/** Where a field's content ends, as a delta from its box's inline-end/block-end corner. */
export interface ContentEndOffset {
  x: number;
  y: number;
}

/**
 * Where a field's content ENDS — the last line's final glyph, vertically
 * centred on that line — as a delta from the box's inline-end/block-end
 * corner. A multi-line field is a tall box whose inline-end sits far past a
 * short final line; anchoring the bubble at this delta pins it right after the
 * final word instead of out in the void. Single-line lands ≈(0, −½line), so
 * the anchor scheme is the same either way, and a delta on the ELEMENT origin
 * lets the overlay re-resolve it on scroll (correct inside a scrolling table).
 *
 * Measured in the render READ phase — riding the reflow a commit already
 * causes, re-run when `track` changes (the committed text, the wrap mode) and
 * when the box resizes (a rewrap moves the last line) — never per hover.
 * `null` while empty. Call in an injection context.
 */
export function watchContentEnd(options: {
  element: () => HTMLElement;
  empty: () => boolean;
  /** Reads whatever re-lays the content out. */
  track: () => void;
}): Signal<ContentEndOffset | null> {
  const offset = signal<ContentEndOffset | null>(null);
  const resized = signal(0);

  const measure = () => {
    const element = options.element();
    if (options.empty()) return offset.set(null);

    // One rect per line of the content; the last one's inline-end is where the
    // final line stops (past the suffix, if any).
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const rects = range.getClientRects();
    if (rects.length === 0) return offset.set(null);

    // Scroll-invariant: box and content shift together.
    const box = element.getBoundingClientRect();
    const last = rects[rects.length - 1];
    offset.set({ x: last.right - box.right, y: last.top + last.height / 2 - box.bottom });
  };

  afterRenderEffect({
    read: () => {
      options.track();
      resized();
      measure();
    },
  });

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => resized.update((tick) => tick + 1));
  afterNextRender(() => observer?.observe(options.element()));
  inject(DestroyRef).onDestroy(() => observer?.disconnect());

  return offset.asReadonly();
}
