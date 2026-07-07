import {
  Component,
  ElementRef,
  TemplateRef,
  inject,
  input,
  model,
  output,
  computed,
  linkedSignal,
  viewChild,
  contentChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

import {
  AngularInlineText,
  EditablePrefix,
  EditableSuffix,
  type InlineTextSaved,
} from 'angular-inline-select';
import { parseTime, parseTimeDraft, formatWallClock, type TimeDraft } from './time-codec';
import { INLINE_TIME_DAY_OFFSET } from './day-offset';
import { INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
import {
  addLocalDays,
  composeDbEntry,
  localDayOf,
  localTimeOf,
  toDbEntry,
  type DbDateTime,
} from '../datetime/db-entry';

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
}

/**
 * Inline time: a `FormValueControl` for times that COMPOSES the inline
 * text control. Canonical value: a **UTC ISO DB entry**
 * (`'2026-07-21T19:00:00.000Z'` — iusta's `toDBEntry`), `null` for empty;
 * the DISPLAY is the local wall-clock reading, localized via `Intl`. The
 * value carries its own date: typed `'HH:mm'` drafts set the local
 * time-of-day on the value's existing day (or `now`'s day when empty).
 *
 * - Drafts are TYPED (`'9'` → 09:00, `'930'`, `'21:05'`) with a live
 *   interpretation preview; impossible times (`'25:00'`) hit the parse gate.
 * - **The picker is the OS's own**: a 🕐 suffix affix drives a
 *   visually-hidden `<input type="time">` — `showPicker()` where the
 *   platform supports it, falling back to focusing the input (mobile opens
 *   its wheels on focus). While editing, a pick replaces the draft; idle,
 *   it commits immediately (the flag-picker convention).
 */
@Component({
  selector: 'angular-inline-time',
  imports: [AngularInlineText, NgTemplateOutlet],
  templateUrl: './angular-inline-time.html',
  styles: `
    :host { display: inline; position: relative; }
    .time-day-badge {
      display: inline-block;
      padding: 0 0.35em;
      margin-inline-end: 0.15em;
      border-radius: var(--mat-sys-corner-small, 0.5rem);
      background: var(--mat-sys-tertiary-container, #e8f0fe);
      color: var(--mat-sys-on-tertiary-container, #174ea6);
      font-size: 0.72em;
      font-weight: 600;
      line-height: 1.6;
      vertical-align: super;
      user-select: none;
    }
    .time-trigger {
      font: inherit;
      line-height: 1;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      border-radius: var(--mat-sys-corner-extra-small, 0.25rem);
    }
    .time-trigger:focus-visible {
      outline: 2px solid var(--mat-sys-primary, #4285f4);
      outline-offset: 2px;
    }
    /* Focusable but invisible — display:none would break focus + showPicker anchoring */
    .time-native {
      position: absolute;
      inset-inline-start: 0;
      inset-block-end: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      border: 0;
      padding: 0;
    }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineTime implements FormValueControl<DbDateTime | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /** The visually-hidden native input backing the OS picker. */
  protected nativeInput = viewChild.required<ElementRef<HTMLInputElement>>('nativeInput');

  /** The committed value channel: a UTC ISO DB entry, or `null`. */
  value = model<DbDateTime | null>(null);

  /** Reference clock — anchors the day of a time typed into an EMPTY field. */
  now = input<() => Date>(() => new Date());

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('time');

  /** Accessible name for the field (contenteditable has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /** Locale for the idle display + preview (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /** Granularity of the native picker, in seconds (forwarded to its `step`). */
  step = input<number>(60);

  /** The 🕐 OS-picker affordance. Off, or overridden by suffix content. */
  showNativePicker = input(true);

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

  protected effectiveDisabled = computed(
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

  /** Whether the suffix slot has anything to render (badge, consumer affix, or 🕐). */
  protected suffixActive = computed(
    () =>
      this.dayOffset() > 0 || this.consumerSuffixTpl() !== undefined || this.showNativePicker(),
  );

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /** Hard commit event: fires once per accepted edit session — a DB entry or `null`. */
  savedModelChange = output<DbDateTime | null>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlineTimeSaved>();

  /** Whether an edit session is open. Two-way bindable. */
  editing = model(false);

  /** The value's LOCAL wall-clock reading — the user-facing side of the split. */
  readonly localTime = computed(() => localTimeOf(this.value()));

  /**
   * The day anchoring a commit: the value's own local day, else `now`'s.
   * FROZEN while a session is open (the linkedSignal freeze pattern) — the
   * live channel writes overflow days into the value, and a drifting
   * anchor would apply them twice.
   */
  #anchorDay = linkedSignal<string, string>({
    source: () => localDayOf(this.value()) ?? localDayOf(toDbEntry(this.now()()))!,
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /**
   * Composes a typed draft onto the anchor day — the ONE outbound path.
   * Overflow hours shift the day (`'24:30'` → anchor + 1 at 00:30).
   */
  #toValue(draft: TimeDraft | null): DbDateTime | null {
    if (draft === null) return null;

    const day = draft.days === 0 ? this.#anchorDay() : addLocalDays(this.#anchorDay(), draft.days);
    return composeDbEntry(day, draft.time);
  }

  /**
   * The string channel feeding the inner control: the localized committed
   * time while idle, the raw draft while a session is open.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => formatWallClock(this.localTime(), this.locale()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /** The current draft's canonical reading (`null` empty, `undefined` unreadable). */
  readonly parsedDraft = computed(() => parseTimeDraft(this.innerValue(), this.locale()));

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(() => this.parsedDraft() === undefined);

  /** Errors forwarded inward: contract + group-routed errors + the parse gate. */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() => {
    const groupErrors = this.#leafState?.errors() ?? [];
    const base = groupErrors.length ? [...this.errors(), ...groupErrors] : this.errors();

    return this.parseFailed() ? [...base, { kind: 'parse' }] : base;
  });

  /** Live interpretation preview: `✓ 9:30 AM`, `✓ 00:30 +1 day` / `… raw`. */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const draft = this.parsedDraft();
    if (draft === null || draft === undefined) return `… ${raw}`;

    const reading = `✓ ${formatWallClock(draft.time, this.locale())}`;
    if (draft.days === 0) return reading;

    return `${reading} +${draft.days} ${draft.days === 1 ? 'day' : 'days'}`;
  });

  /** Live channel: readable drafts flow into the model as DB entries. */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const draft = parseTimeDraft(raw, this.locale());
    if (draft === undefined) return;

    const value = this.#toValue(draft);
    if (value !== this.value()) this.value.set(value);
  }

  /** Retype the settled session: local strings inside, DB entries outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const draft = parseTimeDraft(session.value, this.locale());
    const value = draft === undefined ? this.value() : this.#toValue(draft);
    const dayOverflow = draft === null || draft === undefined ? 0 : draft.days;

    if (session.changed) {
      this.value.set(value);
      this.savedModelChange.emit(value);
    }

    this.saved.emit({ value, changed: session.changed, dayOverflow });
  }

  /** Opens the OS time picker (or focuses the native input where unsupported). */
  protected openNativePicker(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    const native = this.nativeInput().nativeElement;
    native.value = this.localTime() ?? '';

    try {
      native.showPicker();
    } catch {
      native.focus();
    }
  }

  /**
   * A pick from the OS picker: replaces the draft while editing, commits
   * immediately while idle (the flag-picker convention).
   */
  protected handleNativePick(raw: string) {
    const time = parseTime(raw);
    if (time === undefined) return;

    const value = time === null ? null : this.#toValue({ time, days: 0 });

    if (this.editing()) {
      this.innerValue.set(raw);
      if (value !== this.value()) this.value.set(value);
      return;
    }

    if (value !== this.value()) {
      this.value.set(value);
      this.savedModelChange.emit(value);
      this.saved.emit({ value, changed: true, dayOverflow: 0 });
    }
  }

  /** Form Value Contract: focus — delegates to the inner control. */
  focus(options?: FocusOptions) {
    this.inner().focus(options);
  }

  /** Form Value Contract: reset — delegates to the inner control. */
  reset() {
    this.inner().reset();
  }
}
