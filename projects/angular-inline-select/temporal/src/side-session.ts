import {
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';

import { TemporalIntl } from './temporal-intl';

/**
 * The shared per-side session machinery of the temporal family. The date
 * and time controls are the same creature wearing different codecs: two
 * native inputs, a SESSION per side (opens on focusin, settles on Enter/
 * Escape/blur), a frozen draft, snap-back with an aria-live announcement,
 * and per-side clear bubbles. Everything payload-agnostic lives HERE —
 * the controls keep only what genuinely differs (parsing, composition,
 * the calendar panel vs the OS picker).
 */

/** Which endpoint of a range pair a side/session belongs to. */
export type SideKey = 'start' | 'end';

/**
 * Everything one side of the pair owns, payload-generic. A SESSION is a
 * continuous stretch of focus on one side: it opens on focusin (capturing
 * the control's baseline) and settles on Enter, Escape, or focus leaving.
 * Controls extend this with their own session snapshot (the date's
 * per-side baseline day; the time's whole-value baseline + frozen anchor).
 */
export interface SideCore<T> {
  readonly key: SideKey;
  /** This side's committed reading (the value boundary stays DB entries). */
  readonly committed: Signal<T | null>;
  /** Localized display of the committed reading — what the input shows idle. */
  readonly display: Signal<string>;
  /** Whether a session is open on this side. */
  readonly open: WritableSignal<boolean>;
  /**
   * The input's text: user-owned while a session is open (frozen linkedSignal
   * — a value write mid-session never rewrites text under the caret), the
   * committed display otherwise.
   */
  readonly draft: WritableSignal<string>;
  /**
   * Whether the USER touched the draft since the last settlement. An
   * untouched session settles WHERE THE VALUE STANDS — re-deriving it from
   * the draft would undo external writes (a group re-anchoring this leaf)
   * with stale session state.
   */
  dirty: boolean;
  /** Enter was pressed on an unreadable draft — reveals the parse-gate error. */
  readonly saveAttempted: WritableSignal<boolean>;
}

/** Builds a side's shared core — the frozen-draft discipline included. */
export function makeSideCore<T>(
  key: SideKey,
  committed: Signal<T | null>,
  display: Signal<string>,
): SideCore<T> {
  const open = signal(false);
  const draft = linkedSignal<string, string>({
    source: display,
    computation: (source, prev) => (open() ? (prev?.value ?? source) : source),
  });

  return { key, committed, display, open, draft, dirty: false, saveAttempted: signal(false) };
}

/** Content-sized input width, placeholder-floored — no layout shift. */
export function sideSize(draft: string, placeholder: string): number {
  return Math.max(1, (draft || placeholder).length);
}

/**
 * The `null`-shape memory: `null` is the only shape-ambiguous value, so a
 * cleared field keeps emitting the shape its consumer last spoke —
 * `ranged` only seeds the cold start.
 */
export function makeShapeMemory<V, S>(options: {
  value: Signal<V>;
  infer: (value: V) => S | null;
  ranged: Signal<boolean>;
  singleShape: S;
  rangeShape: S;
}): { shape: Signal<S>; twoFields: Signal<boolean> } {
  const last = linkedSignal<V, S | null>({
    source: options.value,
    computation: (value, prev) => options.infer(value) ?? prev?.value ?? null,
  });

  const shape = computed(
    () => last() ?? (options.ranged() ? options.rangeShape : options.singleShape),
  );
  return { shape, twoFields: computed(() => shape() !== options.singleShape) };
}

/**
 * The clear-bubble policy: never on required/disabled/readonly fields,
 * never mid-edit; the single bubble needs ANY value, a range side its own.
 */
export function makeClearBubbleVisibility(options: {
  required: Signal<boolean>;
  disabled: Signal<boolean>;
  readonly: Signal<boolean>;
  editing: Signal<boolean>;
  range: Signal<{ start: unknown; end: unknown }>;
}): { single: Signal<boolean>; start: Signal<boolean>; end: Signal<boolean> } {
  const guards = computed(
    () =>
      !options.required() && !options.disabled() && !options.readonly() && !options.editing(),
  );

  return {
    single: computed(() => {
      const { start, end } = options.range();
      return guards() && !(start === null && end === null);
    }),
    start: computed(() => guards() && options.range().start !== null),
    end: computed(() => guards() && options.range().end !== null),
  };
}

/**
 * The editing bridge: external `editing.set(true)` focuses the start input
 * (focusin opens the session); `set(false)` deactivates — the control
 * settles the focused side and drops its chrome. Internal focus flow
 * writes the model, so states already agree there.
 */
export function wireEditingBridge(options: {
  editing: Signal<boolean>;
  focusTarget: Signal<SideKey | null>;
  focusSide: (key: SideKey) => void;
  deactivate: (focused: SideKey) => void;
}): void {
  effect(() => {
    const editing = options.editing();
    untracked(() => {
      const focused = options.focusTarget();
      if (editing && focused === null) options.focusSide('start');
      else if (!editing && focused !== null) options.deactivate(focused);
    });
  });
}

/**
 * The session chrome one control instance owns: the focus target, the
 * snap-back flash + aria-live announcement, the deferred focus-settlement
 * timer, and focus routing to the side inputs.
 */
export interface SideSessionChrome {
  /** Which side holds focus — the side the panel, picker and preview serve. */
  readonly focusTarget: WritableSignal<SideKey | null>;
  /** Snap-back flash target + the aria-live announcement text. */
  readonly revertFlash: WritableSignal<SideKey | null>;
  readonly revertNotice: WritableSignal<string>;
  /** Focuses a side's input — retrying after render when it isn't there yet. */
  focusSide(key: SideKey): void;
  /**
   * Focusout settles ASYNCHRONOUSLY: where focus LANDS decides what happens
   * (the other input = Tab-advance, the panel/picker = same session,
   * outside = settle), and that is only knowable a tick later.
   */
  scheduleFocusSettle(onSettled: () => void): void;
  /** Snap-back is silent data-restoration — the announcement is not. */
  announceRevert(key: SideKey, restored: string): void;
}

/**
 * Builds a control's session chrome. Timers are cleaned up on destroy —
 * call in an injection context (a field initializer).
 */
export function makeSideSessionChrome(
  inputOf: (key: SideKey) => HTMLInputElement | undefined,
): SideSessionChrome {
  const intl = inject(TemporalIntl);
  const focusTarget = signal<SideKey | null>(null);
  const revertFlash = signal<SideKey | null>(null);
  const revertNotice = signal('');

  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  const injector = inject(Injector);

  inject(DestroyRef).onDestroy(() => {
    if (focusTimer !== null) clearTimeout(focusTimer);
    if (flashTimer !== null) clearTimeout(flashTimer);
  });

  return {
    focusTarget,
    revertFlash,
    revertNotice,

    focusSide(key) {
      const element = inputOf(key);
      if (element) element.focus();
      else afterNextRender(() => inputOf(key)?.focus(), { injector });
    },

    scheduleFocusSettle(onSettled) {
      if (focusTimer !== null) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        focusTimer = null;
        onSettled();
      }, 0);
    },

    announceRevert(key, restored) {
      revertNotice.set(intl.revertedLabel(restored));
      revertFlash.set(key);

      if (flashTimer !== null) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => revertFlash.set(null), 600);
    },
  };
}
