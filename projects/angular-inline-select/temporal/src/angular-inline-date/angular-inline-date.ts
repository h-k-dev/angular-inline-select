import {
  Component,
  inject,
  TemplateRef,
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
import {
  parseDateInput,
  formatInternalRange,
  describeIsoDate,
  buildDateCommands,
  inferDateShape,
  toInternalRange,
  echoDateShape,
  dateValuesEqual,
  type IsoDate,
  type InlineDateValue,
  type DateValueShape,
  type InternalDateRange,
} from './date-codec';
import { INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
import { dayToDbEntry, dayEndToDbEntry, localDayOf } from '../datetime/db-entry';
import { AngularInlineCalendar } from './inline-calendar';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineDateSaved {
  /** The value the session settled on, in the consumer's bound shape. */
  value: InlineDateValue;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline date: a `FormValueControl` for calendar dates that COMPOSES the
 * inline text control. Canonical value: a **UTC ISO DB entry**
 * (`'2026-07-20T22:00:00.000Z'` — iusta's `toDBEntry` of the local
 * `startOf('day')`); the DISPLAY is the localized local calendar day.
 *
 * - Drafts are TYPED (`'12.5.'`, `'12.5.2026'`, `'2026-05-12'`) and never
 *   reformatted under the caret; the live interpretation preview shows the
 *   full reading on every keystroke (`✓ Tuesday, 12 May 2026`).
 * - The slash menu is the quick-pick: `/today`, `/tomorrow`, `/yesterday`
 *   and the next seven weekdays — labels localized via `Intl` (zero bundled
 *   translations), matching the localized AND English names.
 * - A calendar overlay picker is the natural next affordance (same pattern
 *   as the phone's flag picker) — deliberately left open for sandboxing.
 */
@Component({
  selector: 'angular-inline-date',
  imports: [AngularInlineText, AngularInlineCalendar, NgTemplateOutlet],
  templateUrl: './angular-inline-date.html',
  styles: `
    :host { display: inline; }
    .date-command__label { flex: 1 1 auto; text-transform: capitalize; }
    .date-command__value { color: var(--mat-sys-on-surface-variant, #5f6368); font-variant-numeric: tabular-nums; }
    .date-command__empty { padding: 4px 8px; color: var(--mat-sys-on-surface-variant, #5f6368); }
    .date-trigger {
      font: inherit;
      line-height: 1;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      border-radius: var(--mat-sys-corner-extra-small, 0.25rem);
    }
    .date-trigger:focus-visible {
      outline: 2px solid var(--mat-sys-primary, #4285f4);
      outline-offset: 2px;
    }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
    '(keydown)': 'handleHostKeydown($event)',
  },
})
export class AngularInlineDate implements FormValueControl<InlineDateValue> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /**
   * The committed value channel — polymorphic UTC ISO DB entries (iusta's
   * `toDBEntry`): a single string binds a single date, `{ start, end? }`
   * binds a range, and the control ECHOES whichever shape it received.
   * Behind the back a day is its local `startOf('day')` in UTC (range ends
   * `endOf('day')`); the DISPLAY is the localized local calendar day.
   */
  value = model<InlineDateValue>(null);

  /**
   * Cold-start shape default: which shape a `null`-bound field emits before
   * any non-null value has declared one. Ignored once a shape has been seen.
   */
  ranged = input(false);

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('date');

  /** Accessible name for the field (contenteditable has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /** Locale for display + command labels (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /** Enables the `/today`-style slash menu. */
  showDateMenu = input(true);

  /** The 📅 calendar affordance: suffix trigger + the open-on-edit popup. */
  showCalendar = input(true);

  /** Reference clock — injectable for tests; a fresh `Date` per read otherwise. */
  now = input<() => Date>(() => new Date());

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected consumerSuffixTpl = computed(
    () => this.suffixTemplate() ?? this.contentSuffix()?.templateRef,
  );

  /** Whether the suffix slot has anything to render (consumer affix or 📅). */
  protected suffixActive = computed(
    () => this.consumerSuffixTpl() !== undefined || this.showCalendar(),
  );


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

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /** Hard commit event: fires once per accepted edit session, in the bound shape. */
  savedModelChange = output<InlineDateValue>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlineDateSaved>();

  /** Whether an edit session is open. Two-way bindable. */
  editing = model(false);

  /**
   * `null` is the only shape-ambiguous value: this remembers the last shape
   * a non-null value declared, so a cleared field keeps emitting the shape
   * its consumer speaks.
   */
  #lastShape = linkedSignal<InlineDateValue, DateValueShape | null>({
    source: this.value,
    computation: (value, prev) => inferDateShape(value) ?? prev?.value ?? null,
  });

  /** The effective shape: last seen, or the `ranged` cold-start default. */
  readonly shape = computed<DateValueShape>(
    () => this.#lastShape() ?? (this.ranged() ? 'range' : 'single'),
  );

  /**
   * One canonical internal model, always: `{ start, end }` as LOCAL
   * calendar DAYS — the user-facing side; DB entries live only at the
   * value boundary.
   */
  readonly internalRange = computed<InternalDateRange>(() => {
    const { start, end } = toInternalRange(this.value());
    return { start: start === null ? null : localDayOf(start), end: end === null ? null : localDayOf(end) };
  });

  /** The value boundary, outbound: local days → DB entries in the echoed shape. */
  #daysToDbShape(days: InternalDateRange, shape: DateValueShape): InlineDateValue {
    const echoed = echoDateShape(days, shape);
    if (echoed === null) return null;
    if (typeof echoed === 'string') return dayToDbEntry(echoed);

    const start = echoed.start === null ? null : dayToDbEntry(echoed.start);
    if (!('end' in echoed)) return { start };

    return { start, end: echoed.end == null ? null : dayEndToDbEntry(echoed.end) };
  }

  /**
   * The string channel feeding the inner control: the localized committed
   * date (or range) while idle, the raw draft while a session is open.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => formatInternalRange(this.internalRange(), this.locale()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /** The current draft's ISO reading (`null` empty, `undefined` unreadable). */
  readonly parsedDraft = computed(() => parseDateInput(this.innerValue(), this.now()(), this.locale()));

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(() => this.parsedDraft() === undefined);

  /** Errors forwarded inward: contract + group-routed errors + the parse gate. */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() => {
    const groupErrors = this.#leafState?.errors() ?? [];
    const base = groupErrors.length ? [...this.errors(), ...groupErrors] : this.errors();

    return this.parseFailed() ? [...base, { kind: 'parse' }] : base;
  });

  /** Live interpretation preview: `✓ Tuesday, 12 May 2026` / `… raw`. */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const iso = this.parsedDraft();
    if (iso === null || iso === undefined) return `… ${raw}`;

    return `✓ ${describeIsoDate(iso, this.locale())}`;
  });

  /** The slash-menu commands, rebuilt per read so "today" is always today. */
  protected dateCommands = computed(() => buildDateCommands(this.now()(), this.locale()));

  protected commandOptions(query: string) {
    const q = query.trim().toLowerCase();
    const all = this.dateCommands();
    if (!q) return all;

    return all.filter((command) => command.match.includes(q));
  }

  /**
   * Interim single-field merge (until T5's two-field ranged UI): the typed
   * day moves the whole range when it is single-day, and only `start` when
   * a distinct `end` exists; clearing empties both sides. Never invents or
   * drops a shape — that's the echo's job.
   */
  #mergeDay(day: IsoDate | null): InternalDateRange {
    if (day === null) return { start: null, end: null };

    const { start, end } = this.internalRange();
    return end === null || end === start ? { start: day, end: day } : { start: day, end };
  }

  // ---------------------------------------------------------------------------
  // T2b — the calendar lives IN the panel (where the slash menu lives): no
  // second overlay, no positioning math. The typed draft stays primary and
  // the grid is a live MIRROR of it — a parseable draft moves the month
  // and marks the day per keystroke, draft → grid only, until a pick flows
  // back. Slim chrome: no Save/Discard buttons — a pick COMMITS, typing
  // commits via Enter as usual.
  // ---------------------------------------------------------------------------
  protected calendar = viewChild(AngularInlineCalendar);

  /** In-session grid visibility — the 📅 affix toggles it; resets per session. */
  protected calendarVisible = linkedSignal<boolean, boolean>({
    source: this.editing,
    computation: () => true,
  });

  protected calendarActive = computed(() => this.showCalendar() && this.calendarVisible());

  /** The grid's pending day: the parsed draft, else the committed start. */
  protected pendingDay = computed<IsoDate | null>(() => {
    const draft = this.parsedDraft();
    return typeof draft === 'string' ? draft : this.internalRange().start;
  });

  /**
   * The 📅 affix: idle it OPENS the session (panel + grid are one
   * surface); in-session it toggles the grid.
   */
  protected toggleCalendar(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this.editing()) {
      this.editing.set(true);
      return;
    }

    this.calendarVisible.update((visible) => !visible);
  }

  /**
   * ArrowDown in the field hands focus to the grid (the combobox-datepicker
   * shape) — unless the slash menu already consumed the key.
   */
  protected handleHostKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' || event.defaultPrevented) return;
    if (!this.editing() || !this.calendarActive()) return;

    event.preventDefault();
    this.calendar()?.focusGrid();
  }

  /**
   * A pick IS the choice: refocus the field synchronously, rewrite the
   * draft, and COMMIT the session (the panel has no Save button — mouse
   * users click a day, keyboard users type and press Enter).
   */
  protected pickDate(day: IsoDate) {
    this.inner().focus();
    this.handleInnerValue(day);
    // Write the INNER draft synchronously — accept() must not read the
    // pre-pick draft while change detection still owes it the new value.
    this.inner().value.set(day);
    this.inner().accept();
  }

  /** Escape in the grid hands control back to the field (stage one of two). */
  protected escapeCalendar() {
    this.inner().focus();
  }

  /** Live channel: readable drafts flow into the model as DB entries, in the bound shape. */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const day = parseDateInput(raw, this.now()(), this.locale());
    if (day === undefined) return;

    const echoed = this.#daysToDbShape(this.#mergeDay(day), this.shape());
    if (!dateValuesEqual(echoed, this.value())) this.value.set(echoed);
  }

  /** Retype the settled session: local days inside, DB entries in the echoed shape outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const day = parseDateInput(session.value, this.now()(), this.locale());
    const value =
      day === undefined
        ? this.value()
        : this.#daysToDbShape(this.#mergeDay(day), this.shape());

    if (session.changed) {
      this.value.set(value);
      this.savedModelChange.emit(value);
    }

    this.saved.emit({ value, changed: session.changed });
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
