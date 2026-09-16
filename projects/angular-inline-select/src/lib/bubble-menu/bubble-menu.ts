import {
  viewChild,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Renderer2,

  // Signals
  computed,
  effect,
  untracked,
  input,
  signal,
} from '@angular/core';

// CDK
import { OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';

/** Which edge the bubble grows from — the sibling-aware side of a range pair. */
export type BubbleMenuSide = 'start' | 'end';

/**
 * THE POSITION CONTRACT — PUSH, BUT STAY ON THE INLINE.
 *
 * Every position set below holds exactly ONE position, deliberately. Do not add
 * fallbacks to any of them.
 *
 * CDK only PUSHES an overlay (`cdkConnectedOverlayPush`, set in the template)
 * when NO preferred position fits completely: it walks the list and the moment
 * one fits it takes it and returns. So a fallback ALWAYS wins at a screen edge —
 * and it wins badly. The bubble leaves the text line, drops out of its
 * container onto whatever sits below, and anchors to the box's corner, nowhere
 * near a ragged last line.
 *
 * With a single position nothing ever "fits", so CDK pushes along the inline
 * axis instead: the bubble slides inward OVER the field's own text, holding the
 * line's vertical centre exactly. That also keeps the hover bridge intact by
 * construction — a pushed container overlaps the field rather than sitting
 * across a gap from it — and it is why the action pills are painted fully
 * opaque (styles/_editable.scss): they sit on top of live text.
 */

/**
 * Default side: grow toward inline-END, vertically CENTRED on the field — the
 * same vertical placement the text control's measured `contentOffset` resolves
 * to on a single line, so every single-line field (the temporal family) sits
 * on the line instead of riding high off the box's bottom corner. Multi-line
 * text never lands here: it always feeds `contentOffset` (and hides the bubble
 * while empty). start/end are direction-aware — RTL flips for free.
 *
 * The inline offset is ZERO: the container TOUCHES the field so there is no
 * dead zone for the pointer to cross. The visual gap is transparent
 * field-facing padding on `.editable-bubble` (the hover bridge) — see
 * styles/_editable.scss.
 */
const END_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 0 },
];

/**
 * Start side (the inline-START field of a range): grow toward inline-START,
 * centre-anchored — the mirror of {@link END_POSITIONS}, so a range pair's two
 * bubbles open outward and never collide. At the inline-START screen edge it
 * pushes the other way (rightward, over its own field's text), mirroring the
 * end side.
 */
const START_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: 0 },
];

/**
 * Content-offset variant (end side) — used when the host feeds a measured
 * `contentOffset`: the delta from the field's inline-end/block-end CORNER to
 * where the content actually ends (a ragged multi-line field's last glyph,
 * vertically centred on that last line). Still an ELEMENT origin, so CDK
 * re-resolves it on scroll (correct inside scrolling tables); the offset just
 * nudges from the corner to the content end. `offsetX`/`offsetY` are filled in
 * per-instance from the measurement.
 *
 * Single position, per the position contract above — a ragged last line near
 * the inline edge pushes inward over its own text rather than dropping below.
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

  /**
   * A second hover source — an ancestor `editableHoverScope`'s hover or
   * focus-within, wired by the host control. Grace-timed like the origin's
   * own hover, so the pointer can leave the scope onto the bubble (which
   * sits outside the scope's DOM) without a flicker.
   */
  armed = input(false);

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

  /**
   * Pointer intent, as THREE INDEPENDENT terms — the origin's hover, the
   * bubble's own, and the scope's (`armed`) — each with its own grace timer
   * on the leaving edge. The bubble shows while any of them holds.
   *
   * Independent on purpose. One shared flag with one shared timer looped
   * under a real mouse: the pointer leaves the scope ONTO the bubble — the
   * bubble's mouseenter opens it synchronously, then change detection runs
   * the `armed` effect, which scheduled a close on the SAME flag; 150ms later
   * the bubble vanished under the pointer, the row beneath re-armed it, the
   * next pixel of movement replayed the sequence — a constant flash. Three
   * terms cannot cancel each other: a leave only ever clears its own.
   */
  #originHover = hoverTerm();
  #selfHover = hoverTerm();
  #scopeHover = hoverTerm();
  /**
   * The fourth term: the origin HOLDS FOCUS. A field with the caret in it
   * shows its actions without a pointer at all — the tap that placed the
   * caret is what reveals them on touch (there is no hover to arm), and Tab
   * lands on them for keyboard users. Released when focus leaves the origin
   * for anywhere but the bubble itself; no grace needed, focus is discrete.
   */
  #focusHold = signal(false);
  protected visible = computed(
    () =>
      this.canShow() &&
      (this.#originHover.state() ||
        this.#selfHover.state() ||
        this.#scopeHover.state() ||
        this.#focusHold()),
  );

  #renderer = inject(Renderer2);

  constructor() {
    // (Re)bind hover listeners whenever the origin element changes; the effect
    // cleanup unlistens so a swapped origin never leaks a stale handler.
    effect((onCleanup) => {
      const el = this.overlayOrigin();
      const enter = this.#renderer.listen(el, 'mouseenter', () => this.#originHover.enter());
      const leave = this.#renderer.listen(el, 'mouseleave', () => this.#originHover.leave());
      const focusIn = this.#renderer.listen(el, 'focusin', () => this.#focusHold.set(true));
      const focusOut = this.#renderer.listen(el, 'focusout', (event: FocusEvent) => {
        const next = event.relatedTarget as Node | null;
        if (next !== null && (el.contains(next) || this.bubbleRef()?.nativeElement.contains(next)))
          return;
        this.#focusHold.set(false);
      });
      onCleanup(() => {
        enter();
        leave();
        focusIn();
        focusOut();
      });
    });

    // The scope's hover is its own term — grace-timed on the way out like the others.
    let wasArmed = false;
    effect(() => {
      const armed = this.armed();
      if (armed === wasArmed) return;
      wasArmed = armed;
      untracked(() => (armed ? this.#scopeHover.enter() : this.#scopeHover.leave()));
    });

    // A delayed leave must not fire into a destroyed component.
    inject(DestroyRef).onDestroy(() => {
      this.#originHover.dispose();
      this.#selfHover.dispose();
      this.#scopeHover.dispose();
    });
  }

  /** The bubble element while attached — focus moving INTO it must not release the hold. */
  protected bubbleRef = viewChild<ElementRef<HTMLElement>>('bubble');

  /** The bubble's own hover (template-bound). */
  protected open() {
    this.#selfHover.enter();
  }

  protected scheduleClose() {
    this.#selfHover.leave();
  }
}

/** The grace the pointer gets to cross a gap before a hover term lets go. */
const HOVER_GRACE_MS = 150;

/** One hover term: enters at once, leaves after the grace, owns its own timer. */
function hoverTerm() {
  const state = signal(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    state,
    enter() {
      clear();
      state.set(true);
    },
    leave() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        state.set(false);
      }, HOVER_GRACE_MS);
    },
    dispose: clear,
  };
}
