import {
  Component,
  TemplateRef,
  input,
  model,
  output,
  computed,
  linkedSignal,
  viewChild,
  contentChild,
} from '@angular/core';
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
import { dayToDbEntry, dayEndToDbEntry, localDayOf } from '../datetime/db-entry';

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
  imports: [AngularInlineText],
  templateUrl: './angular-inline-date.html',
  styles: `
    :host { display: inline; }
    .date-command__label { flex: 1 1 auto; text-transform: capitalize; }
    .date-command__value { color: var(--mat-sys-on-surface-variant, #5f6368); font-variant-numeric: tabular-nums; }
    .date-command__empty { padding: 4px 8px; color: var(--mat-sys-on-surface-variant, #5f6368); }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
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

  /** Reference clock — injectable for tests; a fresh `Date` per read otherwise. */
  now = input<() => Date>(() => new Date());

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

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
  readonly parsedDraft = computed(() => parseDateInput(this.innerValue(), this.now()()));

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(() => this.parsedDraft() === undefined);

  /** Errors forwarded inward: contract errors + the synthetic parse gate. */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

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

  /** Live channel: readable drafts flow into the model as DB entries, in the bound shape. */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const day = parseDateInput(raw, this.now()());
    if (day === undefined) return;

    const echoed = this.#daysToDbShape(this.#mergeDay(day), this.shape());
    if (!dateValuesEqual(echoed, this.value())) this.value.set(echoed);
  }

  /** Retype the settled session: local days inside, DB entries in the echoed shape outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const day = parseDateInput(session.value, this.now()());
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
