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

import type { EditableClearContext } from 'angular-inline-select';

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
   * committed display otherwise. Its custom `set` (22.1) marks `dirty` in
   * the same synchronous step — a write through this setter IS user input;
   * the one non-user write is `restore()`.
   */
  readonly draft: WritableSignal<string>;
  /**
   * Whether the USER touched the draft since the last settlement. An
   * untouched session settles WHERE THE VALUE STANDS — re-deriving it from
   * the draft would undo external writes (a group re-anchoring this leaf)
   * with stale session state. SET by the draft's own setter (unforgeable —
   * no call site can write a draft and forget the flag); session
   * boundaries clear it explicitly.
   */
  readonly dirty: WritableSignal<boolean>;
  /**
   * Re-renders the committed display into the draft WITHOUT marking dirty —
   * the restore half of the typed/restored distinction (settle-in-place,
   * clear, revert, reset).
   *
   * NOTE this is only the INTERNAL frozen-draft refresh. The consumer's
   * restore path is the VALUE CHANNEL itself: a late write of the old
   * value (backend rejection, intertwined logic) flows in through the
   * linked source — and when the control already restored it (snap-back),
   * the equality dedupe at every layer absorbs the write as a silent
   * no-op. No restore chain re-runs.
   */
  restore(): void;
  /** Enter was pressed on an unreadable draft — reveals the parse-gate error. */
  readonly saveAttempted: WritableSignal<boolean>;
}

/**
 * Builds a side's shared core — the frozen-draft discipline included.
 *
 * `onUserWrite` is the LIVE CHANNEL hook: the draft's setter invokes it in
 * the same synchronous push as marking dirty, so the control's live resolve
 * (readable draft → model) can never be forgotten at a write site — the
 * same law the number/phone `innerValue` setters enforce. `restore()` and
 * source-driven resets trigger neither.
 */
export function makeSideCore<T>(
  key: SideKey,
  committed: Signal<T | null>,
  display: Signal<string>,
  onUserWrite?: () => void,
): SideCore<T> {
  const open = signal(false);
  const dirty = signal(false);

  let restoring = false;
  const draft = linkedSignal<string, string>({
    source: display,
    computation: (source, prev) => (open() ? (prev?.value ?? source) : source),
    set: (value, rawSet) => {
      rawSet(value);
      if (restoring) return;

      dirty.set(true);
      onUserWrite?.();
    },
  });

  const restore = () => {
    restoring = true;
    try {
      draft.set(display());
    } finally {
      restoring = false;
    }
  };

  return { key, committed, display, open, draft, dirty, restore, saveAttempted: signal(false) };
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
    () => !options.required() && !options.disabled() && !options.readonly() && !options.editing(),
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
 * The `editableClear` template contexts — one per bubble a temporal control
 * can stamp (`single`, `start`, `end`). The control keeps owning WHAT a clear
 * does; this only packages the handover: a side-bound callback, the side, and
 * the localized label (also what the STOCK button speaks, so the two can
 * never drift).
 *
 * The callbacks are bound ONCE, outside the computed: a consumer's clear can
 * resolve long after the stamp (a confirmation dialog), and a re-created
 * callback would re-render their button under the pointer for a locale
 * change that has nothing to do with it.
 */
export function makeClearContexts(options: {
  clear: (key: SideKey) => void;
  label: (side: SideKey | 'single') => string;
  focus: (key: SideKey) => void;
}): {
  single: Signal<EditableClearContext>;
  start: Signal<EditableClearContext>;
  end: Signal<EditableClearContext>;
} {
  const clearStart = () => options.clear('start');
  const clearEnd = () => options.clear('end');
  const focusStart = () => options.focus('start');
  const focusEnd = () => options.focus('end');

  const context = (
    clear: () => void,
    focus: () => void,
    side: SideKey | null,
    key: SideKey | 'single',
  ): Signal<EditableClearContext> =>
    computed(() => ({ $implicit: clear, clear, side, label: options.label(key), focus }));

  return {
    // A single field clears the whole value — which IS the start side
    // internally (shape-echo), but the consumer is told `null`: there is no
    // other side to distinguish it from.
    single: context(clearStart, focusStart, null, 'single'),
    start: context(clearStart, focusStart, 'start', 'start'),
    // Focus returns to the side that was cleared, not to the pair's head.
    end: context(clearEnd, focusEnd, 'end', 'end'),
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
