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
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

import { EditablePrefix, EditableSuffix } from 'angular-inline-select';
import { parseTime, parseTimeDraft, formatWallClock, type TimeDraft } from './time-codec';
import { INLINE_TIME_DAY_OFFSET } from './day-offset';
import { INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
import {
  addLocalDays,
  composeDbEntry,
  localTimeOf,
  localDayOf,
  parseDbEntry,
  parseDbEntryDraft,
  todayIn,
  type DbDateTime,
} from '../datetime/db-entry';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineTimeSaved {
  /** The value the session settled on — a UTC ISO DB entry, or `null` for empty. */
  value: DbDateTime | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
  /**
   * The day over-count the user TYPED via overflow hours (`'24:30'` → 1,
   * `'240:30'` → 10) — already applied to `value`, surfaced so a range
   * group can anchor it on the start's day instead of this field's own.
   */
  dayOverflow: number;
  /**
   * The commit CARRIED ITS OWN DAY (a pasted full ISO datetime — the
   * decomposition gesture): a range group must take the instant as-is and
   * never re-anchor it onto the start's day.
   */
  explicitDay: boolean;
}

/**
 * Inline time on a NATIVE INPUT — the input rehost (see ROADMAP-DATETIME).
 * A `FormValueControl` for times. Canonical value: a **UTC ISO DB entry**
 * (`'2026-07-21T19:00:00.000Z'` — iusta's `toDBEntry`), `null` for empty;
 * the DISPLAY is the local wall-clock reading, localized via `Intl`. The
 * value carries its own date: typed `'HH:mm'` drafts set the local
 * time-of-day on the value's existing day (or `now`'s day when empty).
 *
 * Session semantics are GESTURE-TIERED (the family rule): Enter commits
 * (an unreadable draft BLOCKS with the error), Escape reverts to the
 * baseline, Tab/blur commits a readable draft and SNAPS an unreadable one
 * back — never traps, never persists a draft error.
 *
 * - Drafts are TYPED (`'9'` → 09:00, `'930'`, `'21:05'`) with a live
 *   interpretation preview; overflow hours declare the day over-count by
 *   hand (`'24:30'` → next day 00:30, previewed `✓ 00:30 +1 day`).
 * - **The picker is the OS's own, opt-in via `native`**: the field's own
 *   click drives a visually-hidden `<input type="time">` — `showPicker()`
 *   where the platform supports it, falling back to focusing the input
 *   (mobile opens its wheels on focus). There is NO trigger button; typing
 *   is the primary road everywhere. While a session is open, a pick
 *   replaces the draft; idle, it commits immediately.
 */
@Component({
  selector: 'angular-inline-time',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgTemplateOutlet],
  templateUrl: './angular-inline-time.html',
  styles: `
    :host {
      display: inline;
      position: relative;
    }

    .inline-time {
      display: inline-flex;
      align-items: baseline;
      gap: 0.25ch;
      max-width: 100%;
    }

    /* The family look, on an input (see the date control for the rationale). */
    .inline-time__input {
      font: inherit;
      color: inherit;
      background: transparent;
      border: 0;
      padding: 0 0 0.1em;
      margin: 0;
      outline: none;
      min-width: 1ch;
      max-width: 100%;
      field-sizing: content;
      caret-color: var(--editable-text-caret-color, var(--mat-sys-primary, #428bca));
      border-bottom: 0.0625rem dashed
        var(--editable-text-underline-color, var(--mat-sys-primary, #428bca));
    }
    .inline-time__input:focus {
      border-bottom-style: solid;
      border-bottom-width: 0.125rem;
      padding-bottom: calc(0.1em - 0.0625rem);
    }
    .inline-time__input::placeholder {
      font-style: italic;
      color: inherit;
      opacity: var(--editable-text-placeholder-opacity, 0.3875);
    }
    .inline-time__input:disabled {
      cursor: default;
      border-bottom-color: var(--mat-sys-outline, #999);
    }

    .inline-time--invalid .inline-time__input {
      border-bottom-color: var(--editable-text-error-color, var(--mat-sys-error, #dc3545));
    }

    /* BARE CHROME — the hosting container draws the chrome (see the date control). */
    :host(.inline-field-bare) .inline-time__input {
      border-bottom: none;
      padding-bottom: 0;
    }
    :host(.inline-field-bare--hide-placeholder) .inline-time__input::placeholder {
      opacity: 0;
    }

    .inline-time__input--reverted {
      animation: inline-time-revert 0.6s ease-out;
    }
    @keyframes inline-time-revert {
      0% {
        background: color-mix(in srgb, var(--mat-sys-error, #dc3545) 18%, transparent);
      }
      100% {
        background: transparent;
      }
    }

    .inline-time__affix {
      white-space: nowrap;
      user-select: none;
      color: var(--editable-text-affix-color, var(--mat-sys-on-surface-variant, inherit));
    }

    /* The badge's anchor: the input's own box. */
    .inline-time__field {
      position: relative;
      display: inline-flex;
      align-items: baseline;
    }

    /*
      The +n over-count perches on the input's TOP-RIGHT corner (the
      airline-ticket look) — absolutely positioned, so it costs no line
      space and nothing in the row can crowd or obscure it. The inline-end
      overhang has the room it wants: no adornment follows the field.
    */
    .time-day-badge {
      position: absolute;
      top: -0.8em;
      inset-inline-end: -1.1em;
      z-index: 1;
      padding: 0 0.35em;
      border-radius: var(--mat-sys-corner-small, 0.5rem);
      background: var(--mat-sys-tertiary-container, #e8f0fe);
      color: var(--mat-sys-on-tertiary-container, #174ea6);
      font-size: 0.68em;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }

    /* Focusable but invisible — display:none would break focus + showPicker anchoring */
    .inline-time__native {
      position: absolute;
      inset-inline-start: 0;
      inset-block-end: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      border: 0;
      padding: 0;
    }

    .inline-time__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .inline-time__panel {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      background: var(--editable-panel-container-color, var(--mat-sys-surface-container, #fff));
      color: var(--mat-sys-on-surface, inherit);
      border-radius: var(--mat-sys-corner-medium, 0.75rem);
      box-shadow: var(
        --mat-sys-level2,
        0 1px 2px rgba(0, 0, 0, 0.3),
        0 2px 6px 2px rgba(0, 0, 0, 0.15)
      );
    }
    .inline-time__preview {
      padding: 2px 8px;
      font: var(--mat-sys-body-small, 0.8125rem/1.4 system-ui);
      color: var(--mat-sys-on-surface-variant, #5f6368);
      font-variant-numeric: tabular-nums;
    }
    .inline-time__errors:not([hidden]) {
      padding: 0 8px 4px;
      font: var(--mat-sys-body-small, 0.8125rem/1.4 system-ui);
      color: var(--mat-sys-error, #dc3545);
    }

    @media (prefers-reduced-motion: reduce) {
      .inline-time__input--reverted {
        animation: none;
      }
    }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineTime implements FormValueControl<DbDateTime | null> {
  #document = inject(DOCUMENT);

  /** The committed value channel: a UTC ISO DB entry, or `null`. */
  value = model<DbDateTime | null>(null);

  /** Reference clock — anchors the day of a time typed into an EMPTY field. */
  now = input<() => Date>(() => new Date());

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('time');

  /** Accessible name for the field. */
  ariaLabel = input<string | undefined>(undefined);

  /** Locale for the idle display + preview (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /**
   * T6 — the DISPLAY ZONE (IANA id): which zone's wall clock the field
   * speaks. Falls back to the app-wide `INLINE_TEMPORAL_ZONE` provider,
   * then the machine zone. Values stay UTC DB entries.
   */
  zone = input<string | undefined>(undefined);

  #zoneDefault = inject(INLINE_TEMPORAL_ZONE, { optional: true });

  readonly effectiveZone = computed(() => this.zone() ?? this.#zoneDefault?.());

  /** Granularity of the native picker, in seconds (forwarded to its `step`). */
  step = input<number>(60);

  /**
   * T3 — native picker bounds, forwarded to the OS input's `min`/`max`
   * (`'HH:mm'`). Named picker* because signal forms reserves `min`/`max`
   * beside `[formField]` — and they bound the PICKER, not the codec.
   */
  pickerMin = input<string | undefined>(undefined);
  pickerMax = input<string | undefined>(undefined);

  /**
   * NATIVE mode — the one picker affordance: a click on the input opens the
   * OS time picker (the date control's calendar-on-edit convention). Typing
   * stays fully available; the picker is an assist, never the only road.
   * T3's support matrix: `showPicker()` feature-detected, focus fallback
   * (mobile opens its wheels on focus).
   */
  native = input(false);

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected consumerSuffixTpl = computed(
    () => this.suffixTemplate() ?? this.contentSuffix()?.templateRef,
  );

  /**
   * Day-overflow badge feed — provided on this element by the range
   * group's `rangeEnd` role directive; absent (0) everywhere else.
   */
  #groupDayOffset = inject(INLINE_TIME_DAY_OFFSET, { optional: true, self: true });

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

  /** Days the composed end overflows past the start's calendar day (`+1` badge). */
  readonly dayOffset = computed(() => this.#groupDayOffset?.() ?? 0);

  protected dayBadgeAria = computed(() =>
    this.dayOffset() === 1 ? 'plus one day' : `plus ${this.dayOffset()} days`,
  );

  /** Form Value Contract: touch — emitted whenever a session settles. */
  touch = output<void>();

  /** Hard commit event: fires once per changed settlement — a DB entry or `null`. */
  savedModelChange = output<DbDateTime | null>();

  /** Emitted exactly once per settled session (commit, snap-back, Escape, clear). */
  saved = output<InlineTimeSaved>();

  /** Whether an edit session is open (= focus is within). Two-way bindable. */
  editing = model(false);

  /** The value's DISPLAY-ZONE wall-clock reading — the user-facing side of the split. */
  readonly localTime = computed(() => localTimeOf(this.value(), this.effectiveZone()));

  protected display = computed(() => formatWallClock(this.localTime(), this.locale()));

  // -- The session (one field, the date control's side pattern) ------------------

  /** Whether a session is open on this field. */
  #open = signal(false);

  /**
   * The input's text: user-owned while the session is open (frozen
   * linkedSignal — a value write mid-session never rewrites text under the
   * caret), the committed display otherwise.
   */
  protected draft = linkedSignal<string, string>({
    source: this.display,
    computation: (source, prev) => (this.#open() ? (prev?.value ?? source) : source),
  });

  /** The committed VALUE at session start — what Escape and snap-back restore. */
  #baselineValue: DbDateTime | null = null;

  /**
   * Whether the USER touched the draft since the last settlement. An
   * untouched session settles WHERE THE VALUE STANDS — re-composing it from
   * the draft would undo external writes (the group re-anchoring an end
   * instant onto the start's day) with a stale frozen anchor.
   */
  #dirty = false;

  /** Enter was pressed on an unreadable draft — reveals the parse-gate error. */
  #saveAttempted = signal(false);

  /** Enter/Escape hide the panel until the next keystroke or session. */
  #panelDismissed = signal(false);

  /**
   * The day anchoring a commit: the value's own local day, else `now`'s.
   * FROZEN while a session is open (the linkedSignal freeze pattern) — the
   * live channel writes overflow days into the value, and a drifting
   * anchor would apply them twice.
   */
  #anchorDay = linkedSignal<string, string>({
    source: () =>
      localDayOf(this.value(), this.effectiveZone()) ??
      todayIn(this.now()(), this.effectiveZone()),
    computation: (source, prev) => (this.#open() ? (prev?.value ?? source) : source),
  });

  /**
   * Composes a typed draft onto the anchor day — the ONE outbound path.
   * Overflow hours shift the day (`'24:30'` → anchor + 1 at 00:30).
   */
  #toValue(draft: TimeDraft | null): DbDateTime | null {
    if (draft === null) return null;

    const day = draft.days === 0 ? this.#anchorDay() : addLocalDays(this.#anchorDay(), draft.days);
    return composeDbEntry(day, draft.time, this.effectiveZone());
  }

  /** The current draft's canonical reading (`null` empty, `undefined` unreadable). */
  readonly parsedDraft = computed(() => parseTimeDraft(this.draft(), this.locale()));

  /** A pasted FULL ISO datetime — the decomposition gesture carries its own day. */
  readonly explicitDraft = computed(() => parseDbEntryDraft(this.draft(), this.effectiveZone()));

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(
    () => this.parsedDraft() === undefined && this.explicitDraft() === undefined,
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

  /** Live interpretation preview: `✓ 9:30 AM`, `✓ 00:30 +1 day` / `… raw`. */
  protected preview = computed(() => {
    const raw = this.draft().trim();
    if (!raw) return '';

    // A pasted full instant reads back whole: `✓ Jul 25, 2026, 8:00 AM`.
    const explicit = this.explicitDraft();
    if (explicit !== undefined) {
      try {
        return `✓ ${new Intl.DateTimeFormat(this.locale(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: this.effectiveZone(),
        }).format(parseDbEntry(explicit)!)}`;
      } catch {
        return `✓ ${explicit}`;
      }
    }

    const draft = this.parsedDraft();
    if (draft === null || draft === undefined) return `… ${raw}`;

    const reading = `✓ ${formatWallClock(draft.time, this.locale())}`;
    if (draft.days === 0) return reading;

    return `${reading} +${draft.days} ${draft.days === 1 ? 'day' : 'days'}`;
  });

  /** The panel appears when there is something to say — a reading or an error. */
  protected panelOpen = computed(
    () =>
      this.#open() &&
      !this.#panelDismissed() &&
      (this.preview() !== '' || this.errorSlotVisible()),
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

  protected revertFlash = signal(false);
  protected revertNotice = signal('');

  protected timeInput = viewChild<ElementRef<HTMLInputElement>>('timeInput');
  protected nativeInput = viewChild.required<ElementRef<HTMLInputElement>>('nativeInput');
  protected panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  #focusCheckTimer: ReturnType<typeof setTimeout> | null = null;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.#focusCheckTimer !== null) clearTimeout(this.#focusCheckTimer);
      if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    });

    // The editing bridge: external `editing.set(true)` focuses the input;
    // `set(false)` settles and blurs. Internal focus flow writes the model,
    // so states already agree there.
    effect(() => {
      const editing = this.editing();
      untracked(() => {
        const open = this.#open();
        if (editing && !open) {
          this.timeInput()?.nativeElement.focus();
        } else if (!editing && open) {
          this.#settle();
          this.timeInput()?.nativeElement.blur();
        }
      });
    });
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

  /** Every keystroke: readable drafts flow into the model live. */
  protected handleInput(raw: string) {
    this.#openSession();
    this.draft.set(raw);
    this.#dirty = true;
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(false);

    // A pasted full ISO datetime is an EXPLICIT instant — no anchor day.
    const explicit = parseDbEntryDraft(raw, this.effectiveZone());
    if (explicit !== undefined) {
      if (explicit !== this.value()) this.value.set(explicit);
      return;
    }

    const draft = parseTimeDraft(raw, this.locale());
    if (draft === undefined) return;

    const value = this.#toValue(draft);
    if (value !== this.value()) this.value.set(value);
  }

  // -- Focus flow -------------------------------------------------------------------

  protected handleFocusIn() {
    this.#openSession();
    this.editing.set(true);
  }

  /**
   * Focusout settles ASYNCHRONOUSLY: focus landing on the native picker
   * input or the panel stays inside the session; anywhere else settles —
   * commit-if-readable, snap-back if not. Never trap.
   */
  protected handleFocusOut() {
    if (this.#focusCheckTimer !== null) clearTimeout(this.#focusCheckTimer);
    this.#focusCheckTimer = setTimeout(() => this.#onFocusSettled(), 0);
  }

  #onFocusSettled() {
    this.#focusCheckTimer = null;
    const active = this.#document.activeElement;
    const inField = active !== null && active === this.timeInput()?.nativeElement;
    const inNative = active !== null && active === this.nativeInput().nativeElement;
    const inPanel = (active !== null && this.panelRef()?.nativeElement.contains(active)) ?? false;

    if (!inField && !inNative && !inPanel) {
      this.#settle();
      this.editing.set(false);
    }
  }

  // -- Settlement (ONE per session — commit, snap-back, Escape, clear) --------------

  #settle(options: { revert?: boolean; keepOpen?: boolean } = {}) {
    if (!this.#open()) return;

    // An untouched session settles where the value stands (see #dirty).
    const untouched = !options.revert && !this.#dirty;

    let value: DbDateTime | null;
    let dayOverflow = 0;
    let explicitDay = false;
    let snappedBack = false;

    if (untouched) {
      value = this.value();
    } else if (options.revert) {
      value = this.#baselineValue;
    } else {
      const explicit = parseDbEntryDraft(this.draft(), this.effectiveZone());
      if (explicit !== undefined) {
        // The decomposition gesture: the instant carries its own day.
        value = explicit;
        explicitDay = true;
      } else {
        const draft = parseTimeDraft(this.draft(), this.locale());
        if (draft === undefined) {
          // Snap-back: an unreadable draft reverts to the session baseline.
          snappedBack = true;
          value = this.#baselineValue;
        } else {
          value = this.#toValue(draft);
          dayOverflow = draft?.days ?? 0;
        }
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

    if (changed) this.savedModelChange.emit(value);
    this.saved.emit({ value, changed, dayOverflow, explicitDay });
  }

  #announceRevert(value: DbDateTime | null) {
    const restored = value === null ? 'empty' : formatWallClock(localTimeOf(value), this.locale());
    this.revertNotice.set(`Reverted to ${restored}`);
    this.revertFlash.set(true);

    if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => this.revertFlash.set(false), 600);
  }

  // -- Keyboard -----------------------------------------------------------------------

  protected handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
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
   * Toggles the preview panel. PUBLIC — the container-click affordance a
   * hosting container (the mat-form-field adapter) delegates to. (The
   * panel stays content-gated: with nothing to say it remains empty-quiet.)
   */
  togglePanel() {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;
    this.#panelDismissed.update((dismissed) => !dismissed);
  }

  // -- The OS picker ---------------------------------------------------------------------

  /**
   * Opens the OS time picker. T3's support matrix: `showPicker()` where the
   * platform ships it (Chrome/Edge/Android; feature-DETECTED — Safari
   * desktop lacks the method entirely) and may still throw without a user
   * gesture or in cross-origin iframes — both roads fall back to focusing
   * the input (iOS opens its wheels on focus).
   */
  /**
   * Native mode: the input's own click is the picker affordance. The click
   * has already focused the field (the session is open), so a pick lands as
   * a draft replacement — the calendar-on-edit convention.
   */
  protected handleFieldClick() {
    if (!this.native() || this.effectiveDisabled() || this.effectiveReadonly()) return;
    this.#showOsPicker();
  }

  #showOsPicker() {
    const native = this.nativeInput().nativeElement;
    native.value = this.localTime() ?? '';

    if (typeof native.showPicker !== 'function') {
      native.focus();
      return;
    }

    try {
      native.showPicker();
    } catch {
      native.focus();
    }
  }

  /**
   * A pick from the OS picker: replaces the draft while a session is open,
   * commits immediately while idle (the flag-picker convention).
   */
  protected handleNativePick(raw: string) {
    const time = parseTime(raw);
    if (time === undefined) return;

    if (this.#open()) {
      this.draft.set(raw);
      this.#dirty = true;
      this.#panelDismissed.set(false);
      const value = time === null ? null : this.#toValue({ time, days: 0 });
      if (value !== this.value()) this.value.set(value);
      return;
    }

    const value = time === null ? null : this.#toValue({ time, days: 0 });
    if (value !== this.value()) {
      this.value.set(value);
      this.savedModelChange.emit(value);
      this.saved.emit({ value, changed: true, dayOverflow: 0, explicitDay: false });
    }
  }

  // -- Form Value Contract ------------------------------------------------------------------

  focus(options?: FocusOptions) {
    this.timeInput()?.nativeElement.focus(options);
  }

  /**
   * Presentation-only rollback (the MatInput precedent): an open draft is
   * discarded back to the baseline with no `touch`, no `saved`, no focus
   * stealing.
   */
  reset() {
    if (!this.#open()) return;

    if (this.#baselineValue !== this.value()) this.value.set(this.#baselineValue);
    this.draft.set(this.display());
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(true);
  }
}
