import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

import {
  EDITABLE_SCOPE,
  EditablePrefix,
  EditableSuffix,
  type BubbleMenuSide,
  BubbleMenu,
  EditableClearButton,
} from 'angular-inline-select';
import {
  parseDuration,
  formatDuration,
  timeDetailsFromSeconds,
  type DurationFormat,
  type DurationSavedDetails,
} from './duration-codec';
import { TemporalIntl } from '../temporal-intl';
import { INLINE_TEMPORAL_BUBBLE_SIDE, INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineDurationSaved {
  /** The value the session settled on — SECONDS, or `null` for empty. */
  value: number | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline duration on a NATIVE INPUT — the input rehost (see
 * ROADMAP-DATETIME). A `FormValueControl` for durations. Canonical value:
 * SECONDS (`number | null`, empty commits `null`).
 *
 * Session semantics are GESTURE-TIERED (the family rule): Enter commits
 * (an unreadable draft BLOCKS with the error), Escape reverts to the
 * baseline, Tab/blur commits a readable draft and SNAPS an unreadable one
 * back — never traps, never persists a draft error.
 *
 * - Drafts accept colon notation (positional by `durationFormat`), unit
 *   tokens (`'1h 30m'`, `'45m'`, `'1.5h'`), or a bare number (minutes under
 *   hour formats, seconds under `mm:ss`).
 * - Commits round-trip the codec (`'90'` under `h:mm` settles as `'01:30'`)
 *   and snap to `step` seconds when set (e.g. 60 for whole minutes).
 */
@Component({
  selector: 'angular-inline-duration',
  imports: [
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    NgTemplateOutlet,
    BubbleMenu,
    EditableClearButton,
  ],
  templateUrl: './angular-inline-duration.html',
  styleUrl: './angular-inline-duration.scss',
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDuration implements FormValueControl<number | null> {
  #document = inject(DOCUMENT);

  /** The committed value channel: duration in SECONDS, or `null`. */
  value = model<number | null>(null);

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('0:00');

  /**
   * The UNIFORM adapter surface (every temporal control exposes it): the
   * resolved placeholder text, so hosting containers never branch on the
   * concrete control.
   */
  readonly placeholderText = computed(() => this.placeholder());

  /** Accessible name for the field. */
  ariaLabel = input<string | undefined>(undefined);

  /**
   * Which edge the clear bubble grows from. Unset, the leaf ROLE decides
   * (`INLINE_TEMPORAL_BUBBLE_SIDE` — inline-START leaves provide `'start'`
   * so the outer leaves open outward), else `'end'`.
   */
  clearBubbleSide = input<BubbleMenuSide | undefined>(undefined);

  #bubbleSideDefault = inject(INLINE_TEMPORAL_BUBBLE_SIDE, { optional: true });

  protected effectiveClearBubbleSide = computed(
    () => this.clearBubbleSide() ?? this.#bubbleSideDefault ?? 'end',
  );

  /** How colon notation reads and how committed values render. */
  durationFormat = input<DurationFormat>('h:mm');

  /** Snap committed values to a multiple of this many seconds (1 = off). */
  step = input<number>(1);

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /**
   * Group-forwarded contract state (role-provided; absent standalone).
   * Merged by PULL — the leaf stays decoupled, no effects involved.
   */
  #leafState = inject(INLINE_TEMPORAL_LEAF_STATE, { optional: true, self: true });

  /** Public: the composed disabled verdict (own input + group-fed state). */
  readonly effectiveDisabled = computed(
    () => this.disabled() || (this.#leafState?.disabled() ?? false),
  );
  protected effectiveReadonly = computed(
    () => this.readonly() || (this.#leafState?.readonly() ?? false),
  );
  protected effectiveTouched = computed(
    () => this.touched() || (this.#leafState?.touched() ?? false),
  );
  protected effectiveInvalid = computed(
    () => this.invalid() || (this.#leafState?.invalid() ?? false),
  );

  /** Form Value Contract: touch — emitted whenever a session settles. */
  touch = output<void>();

  /**
   * THE consumer commit event — the family DNA: fires once per changed
   * settlement (accept-timed, change-gated) with the duration MODEL as a
   * details object (`DurationSavedDetails` — consumers read `.duration`;
   * empty/cleared reports zero, iusta's house law). The raw seconds still
   * flow through `value`.
   */
  savedModelChange = output<DurationSavedDetails>();

  /**
   * The MACHINERY channel: exactly one emission per settled session (commit,
   * snap-back, Escape, clear — changed or not). Range groups and hosting
   * adapters bind this; app consumers should bind `savedModelChange`.
   */
  saved = output<InlineDurationSaved>();

  /** Whether an edit session is open (= focus is within). Two-way bindable. */
  editing = model(false);

  protected display = computed(() => formatDuration(this.value(), this.durationFormat()));

  // -- The session (one field, the date control's side pattern) ------------------

  /** Whether a session is open on this field. */
  #open = signal(false);

  /**
   * The input's text: user-owned while the session is open (frozen
   * linkedSignal), the committed display otherwise.
   */
  protected draft = linkedSignal<string, string>({
    source: this.display,
    computation: (source, prev) => (this.#open() ? (prev?.value ?? source) : source),
  });

  /** The committed VALUE at session start — what Escape and snap-back restore. */
  #baselineValue: number | null = null;

  /**
   * Whether the USER touched the draft since the last settlement. An
   * untouched session settles WHERE THE VALUE STANDS — re-deriving it from
   * the draft would undo external writes (a group moving this length) with
   * stale session state.
   */
  #dirty = false;

  /** Enter was pressed on an unreadable draft — reveals the parse-gate error. */
  #saveAttempted = signal(false);

  /** Enter/Escape hide the panel until the next keystroke or session. */
  #panelDismissed = signal(false);

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(
    () => parseDuration(this.draft(), this.durationFormat()) === undefined,
  );

  #selfTouched = signal(false);

  protected isInvalid = computed(
    () =>
      this.effectiveInvalid() ||
      this.errors().length > 0 ||
      (this.#leafState?.errors().length ?? 0) > 0,
  );

  /**
   * The mat split: the consumer decides what errors say, the field when they
   * show. Public — the field's presentational verdict, the thing a hosting
   * container (a mat-form-field adapter) needs to mirror.
   */
  readonly errorsVisible = computed(
    () => this.isInvalid() && (this.effectiveTouched() || this.#selfTouched()),
  );

  /** Public: whether the field holds no value. */
  readonly isEmpty = computed(() => this.value() === null);

  protected parseGateVisible = computed(() => this.#saveAttempted() && this.parseFailed());

  protected errorSlotVisible = computed(() => this.errorsVisible() || this.parseGateVisible());

  /** The panel appears only to carry an error — there is no live preview. */
  protected panelOpen = computed(
    () => this.#open() && !this.#panelDismissed() && this.errorSlotVisible(),
  );

  /** Public: whether the panel is showing (hosting containers coordinate on it). */
  readonly panelVisible = computed(() => this.panelOpen());

  /** An outside click dismisses the panel — the session survives (focusout settles). */
  protected dismissPanel() {
    this.#panelDismissed.set(true);
  }

  protected overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  #intl = inject(TemporalIntl);

  protected revertFlash = signal(false);
  protected revertNotice = signal('');

  protected durationInput = viewChild<ElementRef<HTMLInputElement>>('durationInput');
  protected panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  #focusCheckTimer: ReturnType<typeof setTimeout> | null = null;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.#focusCheckTimer !== null) clearTimeout(this.#focusCheckTimer);
      if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    });

    // The editing bridge — see the date control.
    effect(() => {
      const editing = this.editing();
      untracked(() => {
        const open = this.#open();
        if (editing && !open) {
          this.durationInput()?.nativeElement.focus();
        } else if (!editing && open) {
          this.#settle();
          this.durationInput()?.nativeElement.blur();
        }
      });
    });
  }

  #snap(seconds: number): number {
    const step = this.step();
    return step > 1 ? Math.round(seconds / step) * step : seconds;
  }

  protected sizeOf(): number {
    return Math.max(1, (this.draft() || this.placeholder()).length);
  }

  protected ariaInvalid(): boolean {
    return this.errorsVisible() || (this.#open() && this.#saveAttempted() && this.parseFailed());
  }

  // -- The live channel -----------------------------------------------------------

  #openSession() {
    if (this.#open()) return;
    this.#baselineValue = this.value();
    this.#dirty = false;
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(false);
    this.#open.set(true);
  }

  /** Every keystroke: readable drafts flow into the model live (unsnapped). */
  protected handleInput(raw: string) {
    this.#openSession();
    this.draft.set(raw);
    this.#dirty = true;
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(false);

    const parsed = parseDuration(raw, this.durationFormat());
    if (parsed !== undefined && parsed !== this.value()) this.value.set(parsed);
  }

  // -- Focus flow -------------------------------------------------------------------

  protected handleFocusIn() {
    this.#openSession();
    this.editing.set(true);
  }

  protected handleFocusOut() {
    if (this.#focusCheckTimer !== null) clearTimeout(this.#focusCheckTimer);
    this.#focusCheckTimer = setTimeout(() => this.#onFocusSettled(), 0);
  }

  #onFocusSettled() {
    this.#focusCheckTimer = null;
    const active = this.#document.activeElement;
    const inField = active !== null && active === this.durationInput()?.nativeElement;
    const inPanel = (active !== null && this.panelRef()?.nativeElement.contains(active)) ?? false;

    if (!inField && !inPanel) {
      this.#settle();
      this.editing.set(false);
    }
  }

  // -- Settlement (ONE per session — commit, snap-back, Escape, clear) --------------

  #settle(options: { revert?: boolean; keepOpen?: boolean } = {}) {
    if (!this.#open()) return;

    // An untouched session settles where the value stands (see #dirty).
    const untouched = !options.revert && !this.#dirty;

    let value: number | null;
    let snappedBack = false;

    if (untouched) {
      value = this.value();
    } else if (options.revert) {
      value = this.#baselineValue;
    } else {
      const parsed = parseDuration(this.draft(), this.durationFormat());
      if (parsed === undefined) {
        // Snap-back: an unreadable draft reverts to the session baseline.
        snappedBack = true;
        value = this.#baselineValue;
      } else {
        value = parsed === null ? null : this.#snap(parsed);
      }
    }

    if (!untouched && value !== this.value()) this.value.set(value);
    const changed = !untouched && value !== this.#baselineValue;
    this.#dirty = false;

    if (options.keepOpen) {
      this.#baselineValue = value;
      this.draft.set(this.display());
      this.#saveAttempted.set(false);
    } else {
      this.#open.set(false);
      this.#saveAttempted.set(false);
    }

    if (snappedBack) this.#announceRevert(value);

    this.#selfTouched.set(true);
    this.touch.emit();

    if (changed) this.#emitSavedModel();
    this.saved.emit({ value, changed });
  }

  /** The commit payload — total seconds + clock decomposition (empty IS zero). */
  #emitSavedModel() {
    const seconds = this.value() ?? 0;
    this.savedModelChange.emit({ ...timeDetailsFromSeconds(seconds), duration: seconds });
  }

  #announceRevert(value: number | null) {
    const restored = value === null ? '' : formatDuration(value, this.durationFormat());
    this.revertNotice.set(this.#intl.revertedLabel(restored));
    this.revertFlash.set(true);

    if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => this.revertFlash.set(false), 600);
  }

  // -- Keyboard -----------------------------------------------------------------------

  /**
   * The ancestor Tab-to-accept scope, or `null` — see the date control: the
   * commit already rides the native focusout; only the Tab's landing spot
   * is the scope's business (single input, so every Tab is an edge Tab).
   */
  #scope = inject(EDITABLE_SCOPE, { optional: true });

  protected handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Tab': {
        const scope = this.#scope;
        if (!scope?.tabCommits()) return;

        // `'stay'` refuses the Tab like Enter's parse gate (Tab gesture
        // only — blur keeps the native snap-back regardless of policy).
        if (
          scope.onBlocked() === 'stay' &&
          parseDuration(this.draft(), this.durationFormat()) === undefined
        ) {
          event.preventDefault();
          this.#saveAttempted.set(true);
          scope.announce('blocked');
          return;
        }

        // Own the Tab only when the walk can place it — at the scope's edge
        // the native Tab proceeds (blur settles, focus leaves the region).
        if (scope.advanceFrom(event.target as HTMLElement, event.shiftKey ? -1 : 1)) {
          event.preventDefault();
        }
        return;
      }
      case 'Enter': {
        event.preventDefault();
        if (parseDuration(this.draft(), this.durationFormat()) === undefined) {
          // The parse gate: the user ASKED for a commit — block and say why.
          this.#saveAttempted.set(true);
          return;
        }

        this.#settle({ keepOpen: true });
        this.#panelDismissed.set(true);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
        this.#settle({ revert: true, keepOpen: true });
        this.#panelDismissed.set(true);
        return;
      }
    }
  }

  /**
   * Toggles the error panel. PUBLIC — the container-click affordance a
   * hosting container (the mat-form-field adapter) delegates to. (With no
   * error to show the panel stays empty-quiet — there is no live preview.)
   */
  togglePanel() {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;
    this.#panelDismissed.update((dismissed) => !dismissed);
  }

  // -- Clear affordance (idle hover bubble) --------------------------------------

  /** The clear bubble may show while idle and non-empty on an unlocked field. */
  protected clearCanShow = computed(
    () =>
      !this.required() &&
      !this.effectiveDisabled() &&
      !this.effectiveReadonly() &&
      !this.editing() &&
      !this.isEmpty(),
  );

  /**
   * Clears the field from the idle hover bubble — a commit AND an interaction
   * (mat-faithful): writes `null`, marks the field touched, and settles once
   * so a bound schema (and a range group) sees the clear.
   */
  protected clearBubble() {
    // Idle-only: the bubble is hidden while editing; guard anyway.
    if (this.editing() || this.value() === null) return;

    this.value.set(null);
    this.#baselineValue = null;
    this.draft.set(this.display());
    this.#saveAttempted.set(false);

    this.#selfTouched.set(true);
    this.touch.emit();
    this.#emitSavedModel();
    this.saved.emit({ value: null, changed: true });
  }

  // -- Form Value Contract ------------------------------------------------------------------

  focus(options?: FocusOptions) {
    this.durationInput()?.nativeElement.focus(options);
  }

  /** Presentation-only rollback — see the date control. */
  reset() {
    if (!this.#open()) return;

    if (this.#baselineValue !== this.value()) this.value.set(this.#baselineValue);
    this.draft.set(this.display());
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(true);
  }
}
