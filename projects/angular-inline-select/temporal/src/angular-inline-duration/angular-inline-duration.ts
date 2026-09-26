import {
  afterNextRender,
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
  type EditableClearContext,
  BubbleMenu,
  EditableClearButton,
  EditableClearTemplate,
  observeHoverScope,
  type EditableHoverScopePress,
  EditableActionsTemplate,
  type EditableActionsContext,
} from 'angular-inline-select';
import {
  parseDuration,
  formatDuration,
  timeDetailsFromSeconds,
  durationCodecFormat,
  durationPlaceholder,
  type DurationDisplayFormat,
  type DurationSavedDetails,
} from './duration-codec';
import { TemporalIntl } from '../temporal-intl';
import { INLINE_TEMPORAL_BUBBLE_SIDE, INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
import { INLINE_TEMPORAL_MAT_CONTROL } from '../mat-control';
import { focusInputNearPoint, isUnitSpacePress } from '../inline-unit';
import { roundToInterval, type IntervalRounding } from '../interval-rounding';

/** The `editableActions` payload of the duration control: the committed seconds. */
export interface InlineDurationActions {
  value: number | null;
  /** A single-value control: always null (the context shape is shared with the range controls). */
  side: null;
}

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
 * - Drafts accept colon notation (positional by `format`), unit
 *   tokens (`'1h 30m'`, `'45m'`, `'1.5h'`), or a bare number (minutes under
 *   hour formats, seconds under `mm:ss`).
 * - Commits round-trip the codec (`'90'` under `h:mm` settles as `'01:30'`)
 *   and land on the `intervalStep` grid when set — `intervalRounding`
 *   (default `'ceil'`) says how.
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
  // The form-field adapter's one way in (`inlineMatFormField`, /temporal-mat).
  providers: [{ provide: INLINE_TEMPORAL_MAT_CONTROL, useExisting: AngularInlineDuration }],
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDuration implements FormValueControl<number | null> {
  #document = inject(DOCUMENT);

  /** The committed value channel: duration in SECONDS; empty is `emptyValue`. */
  value = model<number | null>(null);

  /**
   * What EMPTY is on the value channel — `null` by default. A backend that
   * stores "no duration" as a number (`0`) passes it here: the field then
   * reads that value as empty (placeholder, no clear bubble) and writes it
   * when cleared or emptied. The one wire-format escape hatch.
   */
  emptyValue = input<number | null>(null);

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  /** Overrides the per-format placeholder (`'HH:MM'` …). */
  placeholder = input<string | undefined>(undefined);

  /**
   * The UNIFORM adapter surface (every temporal control exposes it): the
   * resolved placeholder text, so hosting containers never branch on the
   * concrete control.
   */
  readonly placeholderText = computed(
    () => this.placeholder() ?? durationPlaceholder(this.format()),
  );

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

  /**
   * How colon notation reads and how committed values render, in the house
   * tokens: `'HH:mm'` (hours:minutes), `'HH:mm:ss'`, or `'mm:ss'`.
   */
  format = input<DurationDisplayFormat>('HH:mm');

  /** The codec's positional reading of {@link format}. */
  #codecFormat = computed(() => durationCodecFormat(this.format()));

  /**
   * The rounding grid in seconds — committed lengths land on a multiple
   * (1 = off). A required-but-shorter length settles AS the step: a required
   * duration never commits as nothing.
   */
  intervalStep = input(1);

  /** How a committed length lands on the `intervalStep` grid (default: up). */
  intervalRounding = input<IntervalRounding>('ceil');

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
  touch = output();

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

  protected display = computed(() =>
    this.isEmpty() ? '' : formatDuration(this.value(), this.#codecFormat()),
  );

  // -- The session (one field, the date control's side pattern) ------------------

  /** Whether a session is open on this field. */
  #open = signal(false);

  /**
   * The input's text: user-owned while the session is open (frozen
   * linkedSignal), the committed display otherwise. The custom `set` (22.1)
   * marks `#dirty` in the same synchronous step — a write through the
   * setter IS user input; the one non-user write is `#restoreDraft()`.
   */
  protected draft = linkedSignal<string, string>({
    source: this.display,
    computation: (source, prev) => (this.#open() ? (prev?.value ?? source) : source),
    set: (value, rawSet) => {
      rawSet(value);
      if (this.#restoring) return;

      this.#dirty = true;
      // The live channel: readable drafts flow into the model in the same
      // synchronous push (unsnapped — rounding is settlement's job).
      const parsed = parseDuration(value, this.#codecFormat());
      if (parsed === undefined) return;

      const next = parsed ?? this.emptyValue();
      if (next !== this.value()) this.value.set(next);
    },
  });

  #restoring = false;

  /** Re-renders the committed display into the draft WITHOUT marking dirty. */
  #restoreDraft() {
    this.#restoring = true;
    try {
      this.draft.set(this.display());
    } finally {
      this.#restoring = false;
    }
  }

  /** The committed VALUE at session start — what Escape and snap-back restore. */
  #baselineValue: number | null = null;

  /**
   * Whether the USER touched the draft since the last settlement. An
   * untouched session settles WHERE THE VALUE STANDS — re-deriving it from
   * the draft would undo external writes (a group moving this length) with
   * stale session state. Set by the draft's own setter — no call site can
   * write a draft and forget the flag.
   */
  #dirty = false;

  /** Enter was pressed on an unreadable draft — reveals the parse-gate error. */
  #saveAttempted = signal(false);

  /**
   * Whether a HOSTING container renders this field's errors — the
   * mat-form-field adapter sets it — so the error overlay stays closed and
   * the container's own error area speaks. A `model` so the host directive on
   * this element can `.set()` it.
   */
  externalErrors = model(false);

  /** Enter/Escape hide the panel until the next keystroke or session. */
  #panelDismissed = signal(false);

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(
    () => parseDuration(this.draft(), this.#codecFormat()) === undefined,
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
  readonly isEmpty = computed(() => {
    const value = this.value();
    return value === null || value === this.emptyValue();
  });

  protected parseGateVisible = computed(() => this.#saveAttempted() && this.parseFailed());

  protected errorSlotVisible = computed(() => this.errorsVisible() || this.parseGateVisible());

  /** The message-carrying errors — the overlay's default content (mat-error's analogue). */
  protected errorMessages = computed(() => this.errors().filter((error) => !!error.message));

  /** The parse gate's own line: an unreadable draft on Enter says so. */
  protected parseGateLabel = computed(() =>
    this.#intl.invalidEntryLabel(this.#intl.durationLabel()),
  );

  /** The panel appears only to carry an error — there is no live preview. */
  protected panelOpen = computed(
    () =>
      this.#open() && !this.externalErrors() && !this.#panelDismissed() && this.errorSlotVisible(),
  );

  /** Public: whether the panel is showing (hosting containers coordinate on it). */
  readonly panelVisible = computed(() => this.panelOpen());

  /** An outside click dismisses the panel — the session survives (focusout settles). */
  protected dismissPanel() {
    this.#panelDismissed.set(true);
  }

  /**
   * Below the field first, above as a fallback; each side also tries an
   * inline-END alignment so a panel near the inline-end screen edge flips
   * instead of overflowing. Should nothing fit (narrow viewports), the
   * template's `cdkConnectedOverlayPush` slides the panel inside the viewport
   * margin rather than leaving it clipped.
   */
  protected overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
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

  /**
   * Lands a committed length on the `intervalStep` grid. Required-but-shorter
   * settles AS the step — an emptied required field on a grid included;
   * otherwise empty settles as `emptyValue`.
   */
  #round(seconds: number | null): number | null {
    const step = this.intervalStep();
    if (seconds === null) return this.required() && step > 1 ? step : this.emptyValue();
    if (step <= 1) return seconds;
    if (seconds < step && this.required()) return step;

    return roundToInterval(seconds, step, this.intervalRounding());
  }

  protected sizeOf(): number {
    return Math.max(1, (this.draft() || this.placeholderText()).length);
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

  /** Every keystroke: the draft setter marks dirty and runs the live parse. */
  protected handleInput(raw: string) {
    this.#openSession();
    this.draft.set(raw);
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(false);
  }

  // -- The interactive unit + the hover scope -------------------------------------

  /** The wrapper around the input — the unit the pointer meets. */
  protected field = viewChild.required<ElementRef<HTMLElement>>('field');

  #unitHost = inject<ElementRef<HTMLElement>>(ElementRef);
  #unitDestroyRef = inject(DestroyRef);

  #inputs(): (HTMLInputElement | undefined)[] {
    return [this.durationInput()?.nativeElement];
  }

  /**
   * A press in the unit OUTSIDE the input — the shape, an affix, the space
   * past a short value — focuses the nearest input with the caret near the
   * point (a native input's padding, generalised). Focus then
   * does what focus does here: the session opens. Presses ON an input keep native
   * caret placement; chrome inside the unit keeps its own handling.
   */
  protected handleUnitMouseDown(event: MouseEvent) {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;
    if (!isUnitSpacePress(event, this.field().nativeElement)) return;

    event.preventDefault();
    focusInputNearPoint(this.#inputs(), event.clientX, event.clientY);
  }

  /**
   * The overlay's outside click, SCOPE-AWARE: a press on the hover scope's
   * own space is the gesture that just focused this control (the scope
   * forwards it, the panel opens on focus), and the CLICK that completes
   * that press lands on the row — outside the overlay's origin, so CDK
   * reports it as outside and the panel would flash open and shut. The row
   * is the unit: a click on it is a click on us. Clicks on another row, or
   * anywhere else, still dismiss.
   */
  protected handleOutsideClick(event: MouseEvent) {
    const scope = this.#hoverScope();
    if (scope !== null && scope.contains(event.target as Node)) return;

    this.dismissPanel();
  }

  /** The scope's press, forwarded (`pressToFocus`): the same landing from a point outside the unit. */
  protected handleScopePress(event: Event) {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;

    const { clientX, clientY } = (event as CustomEvent<EditableHoverScopePress>).detail;
    focusInputNearPoint(this.#inputs(), clientX, clientY);
  }

  /**
   * The nearest `[editableHoverScope]` ancestor, found by DOM after the first
   * render (never injected — the mat-table trap): its hover and focus-within
   * arm the bubble (`armed`, grace-timed there), and the wrapper's modifier
   * hands the paint decision to the styles (the scope paints, the unit's own
   * shape rests unless `--editable-text-shape-in-scope`).
   */
  #hoverScope = signal<HTMLElement | null>(null);
  protected hasHoverScope = computed(() => this.#hoverScope() !== null);
  protected scopeHover = signal(false);

  #watchHoverScope = afterNextRender(() => {
    const watch = observeHoverScope(this.#unitHost.nativeElement, (hover) =>
      this.scopeHover.set(hover),
    );
    this.#hoverScope.set(watch.scope);
    this.#unitDestroyRef.onDestroy(watch.disconnect);
  });

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
      const parsed = parseDuration(this.draft(), this.#codecFormat());
      if (parsed === undefined) {
        // Snap-back: an unreadable draft reverts to the session baseline.
        snappedBack = true;
        value = this.#baselineValue;
      } else {
        value = this.#round(parsed);
      }
    }

    if (!untouched && value !== this.value()) this.value.set(value);
    const changed = !untouched && value !== this.#baselineValue;
    this.#dirty = false;

    if (options.keepOpen) {
      this.#baselineValue = value;
      this.#restoreDraft();
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
    const restored =
      value === null || value === this.emptyValue()
        ? ''
        : formatDuration(value, this.#codecFormat());
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
        if (scope.onBlocked() === 'stay' && this.parseFailed()) {
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
        if (this.parseFailed()) {
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
      this.showClear() &&
      !this.required() &&
      !this.effectiveDisabled() &&
      !this.effectiveReadonly() &&
      !this.editing() &&
      !this.isEmpty(),
  );

  /**
   * Consumer clear affordance — REPLACES the stock button inside the bubble.
   * See {@link EditableClearTemplate}: the context's callback is what makes a
   * confirm-before-clear possible, since clearing IS the commit. Duration is
   * always single-valued, so the context's `side` is always `null`.
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  /**
   * The clear affordance's opt-out. `false` never offers the hover-bubble
   * clear (stock button or `clearTemplate` alike): the value can still be
   * emptied, but only the long way — open the editor, delete, save. For
   * hosts whose house rule is that emptying a field is a deliberate act,
   * never a one-click shortcut. `true` (the default) keeps the bubble's own
   * policy (never on required / disabled / readonly / empty / editing).
   */
  showClear = input(true);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  /** The primary-actions slot. */
  actionsTemplate = input<TemplateRef<EditableActionsContext<InlineDurationActions>> | undefined>(
    undefined,
  );

  private contentActions = contentChild(EditableActionsTemplate<InlineDurationActions>);

  protected actionsTpl = computed(
    () => this.actionsTemplate() ?? this.contentActions()?.templateRef,
  );

  /** Actions ignore required / disabled / readonly on purpose; never mid-edit, never empty. */
  protected actionsCanShow = computed(
    () => this.actionsTpl() !== undefined && !this.editing() && !this.isEmpty(),
  );

  protected actionsContext = computed<EditableActionsContext<InlineDurationActions>>(() => {
    const data: InlineDurationActions = { value: this.value(), side: null };
    return { $implicit: data, data, side: null, focus: this.#focusAction };
  });
  #focusAction = () => this.durationInput()?.nativeElement.focus();

  #clearCallback = () => this.clearBubble();

  #focusCallback = () => this.focus();

  protected clearContext = computed<EditableClearContext>(() => ({
    $implicit: this.#clearCallback,
    clear: this.#clearCallback,
    side: null,
    label: this.#intl.clearLabel('single', this.#intl.durationLabel()),
    focus: this.#focusCallback,
  }));

  /**
   * Clears the field from the idle hover bubble — a commit AND an interaction
   * (mat-faithful): writes `emptyValue`, marks the field touched, and settles
   * once so a bound schema (and a range group) sees the clear.
   */
  protected clearBubble() {
    // Idle-only: the bubble is hidden while editing; guard anyway.
    if (this.editing() || this.isEmpty()) return;

    const empty = this.emptyValue();
    this.value.set(empty);
    this.#baselineValue = empty;
    this.#restoreDraft();
    this.#saveAttempted.set(false);

    this.#selfTouched.set(true);
    this.touch.emit();
    this.#emitSavedModel();
    this.saved.emit({ value: empty, changed: true });
  }

  // -- Form Value Contract ------------------------------------------------------------------

  focus(options?: FocusOptions) {
    this.durationInput()?.nativeElement.focus(options);
  }

  /** Presentation-only rollback — see the date control. */
  reset() {
    if (!this.#open()) return;

    if (this.#baselineValue !== this.value()) this.value.set(this.#baselineValue);
    this.#restoreDraft();
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(true);
  }
}
