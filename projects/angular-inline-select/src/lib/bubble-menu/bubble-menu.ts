import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Renderer2,

  // Signals
  computed,
  effect,
  input,
  signal,
} from '@angular/core';

// CDK
import { OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';

/** Which edge the bubble grows from — the sibling-aware side of a range pair. */
export type BubbleMenuSide = 'start' | 'end';

/**
 * Default side: grow toward inline-END, anchored to the field's BOTTOM
 * (block-end) — so on a tall multi-line field the bubble lands at the END of
 * the paragraph, where the eye already is, not floating at the vertical
 * centre. Falls back to bottom-right (below the field, end-aligned) when there
 * is no inline room. start/end are direction-aware — RTL flips for free.
 *
 * The inline offset is ZERO: the container TOUCHES the field so there is no
 * dead zone for the pointer to cross. The visual gap is transparent
 * field-facing padding on `.editable-bubble` (the hover bridge) — see
 * styles/_editable.scss.
 */
const END_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX: 0 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
];

/**
 * Start side (the inline-START field of a range): grow toward inline-START,
 * bottom-anchored, falling back to bottom-left — the mirror of {@link END_POSITIONS},
 * so a range pair's two bubbles open outward and never collide.
 */
const START_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'end', overlayY: 'bottom', offsetX: 0 },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
];

/**
 * Content-offset variant (end side) — used when the host feeds a measured
 * `contentOffset`: the delta from the field's inline-end/block-end CORNER to
 * where the content actually ends (a ragged multi-line field's last glyph,
 * vertically centred on that last line). Still an ELEMENT origin, so CDK
 * re-resolves it on scroll (correct inside scrolling tables); the offset just
 * nudges from the corner to the content end. `offsetX`/`offsetY` are filled in
 * per-instance from the measurement.
 */
function endOffsetPositions(offset: { x: number; y: number }): ConnectedPosition[] {
  return [
    {
      originX: 'end',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'center',
      offsetX: offset.x,
      offsetY: offset.y,
    },
    // Fallback: below the field, end-aligned (rare — content-end near the edge).
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
  ];
}

/**
 * A Notion-style floating hover menu — a generic, action-agnostic container
 * shared by every inline control (text, number, and the temporal family). It
 * knows nothing about what its buttons do: the consumer PROJECTS them
 * (`<bubble-menu>…buttons…</bubble-menu>`), so today's lone "clear" is just
 * one possible action, not a baked-in assumption.
 *
 * It lives in a CDK overlay so it can never be clipped by a table cell or
 * dialog, owns its own hover state machine (listeners on the origin AND the
 * bubble, with a grace timer + hit-halo padding so the pointer can cross the
 * gap), and handles positioning.
 *
 * The host decides WHEN it may appear (`canShow` — its "not required, not
 * empty, not editing" verdict) and WHICH side it grows from (`side`); the
 * bubble owns the hover term and the positioning.
 */
@Component({
  selector: 'bubble-menu',
  imports: [OverlayModule],
  templateUrl: './bubble-menu.html',
  styleUrl: './bubble-menu.scss',
})
export class BubbleMenu {
  /** The element the bubble anchors to and watches for hover. */
  origin = input.required<ElementRef<HTMLElement> | HTMLElement>();

  /**
   * Optional measured offset — the delta from the origin box's inline-end/
   * block-end CORNER to where the content actually ends (a ragged multi-line
   * field's last glyph, vertically centred on its last line). The overlay
   * still anchors to the origin ELEMENT (CDK re-resolves it on scroll — correct
   * inside scrolling tables); the offset just slides it from the corner to the
   * content end. `null` (the default) anchors to the plain box corner. Only
   * meaningful on the `'end'` side (the multi-line text case).
   */
  contentOffset = input<{ x: number; y: number } | null>(null);

  /** The host's verdict on whether the bubble may show (hover is added here). */
  canShow = input(true);

  /** Which edge to grow from — `'end'` (default) or `'start'` for a range's left field. */
  side = input<BubbleMenuSide>('end');

  protected positions = computed(() => {
    const offset = this.contentOffset();
    if (offset && this.side() === 'end') return endOffsetPositions(offset);
    return this.side() === 'start' ? START_POSITIONS : END_POSITIONS;
  });

  /** The raw origin element (unwrapped from an ElementRef) — anchor AND hover target. */
  protected overlayOrigin = computed(() => {
    const origin = this.origin();
    return origin instanceof ElementRef ? origin.nativeElement : origin;
  });

  /** Pointer intent: over the field or over the bubble itself. */
  #hover = signal(false);
  protected visible = computed(() => this.canShow() && this.#hover());

  #renderer = inject(Renderer2);
  #closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // (Re)bind hover listeners whenever the origin element changes; the effect
    // cleanup unlistens so a swapped origin never leaks a stale handler.
    effect((onCleanup) => {
      const el = this.overlayOrigin();
      const enter = this.#renderer.listen(el, 'mouseenter', () => this.open());
      const leave = this.#renderer.listen(el, 'mouseleave', () => this.scheduleClose());
      onCleanup(() => {
        enter();
        leave();
      });
    });

    // The delayed close must not fire into a destroyed component.
    inject(DestroyRef).onDestroy(() => {
      if (this.#closeTimer !== null) clearTimeout(this.#closeTimer);
    });
  }

  protected open() {
    if (this.#closeTimer !== null) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
    this.#hover.set(true);
  }

  /** Delayed close so the pointer can cross the gap between field and bubble. */
  protected scheduleClose() {
    if (this.#closeTimer !== null) clearTimeout(this.#closeTimer);

    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;
      this.#hover.set(false);
    }, 150);
  }
}
