// Angular
import {
  Component,
  type ElementRef,
  inject,
  type TemplateRef,

  // Signals
  computed,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

// Forms
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

// Editables
import { type EditableClearContext } from 'angular-inline-select';
import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { INLINE_TEMPORAL_MAT_CONTROL } from '../mat-control';
import { makeLeafContract } from '../side-session';
import { TemporalIntl } from '../temporal-intl';

// Datetime
import {
  composeDbEntry,
  localDayOf,
  moveDbEntryToDay,
  type DbDateTime,
} from '../datetime/db-entry';
import { isIsoDate, type IsoDate } from '../datetime/iso-date';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';

/**
 * ONE instant, TWO fields — the datetime editable, composed from the date
 * and the time control:
 *
 * - `value` is a UTC ISO DB entry, `null` for empty. Committing the DATE
 *   leaf moves the instant onto the picked day PRESERVING its wall-clock
 *   time (midnight when starting empty); committing the TIME leaf sets the
 *   wall clock on the instant's own day — both leaves edit THE SAME instant.
 * - The DISPLAY ZONE is configuration: the `zone` input, falling back to
 *   `INLINE_TEMPORAL_ZONE`, then the machine zone. The value NEVER carries
 *   the zone.
 * - Everything the leaves know travels for free: gesture-tiered sessions,
 *   the calendar grid (`dayFilter` reaches the date leaf), snap-back, the OS
 *   time picker, ISO-paste, native Tab date → time.
 *
 * The COMPOSITE is the control; the leaves are its parts — the shape of
 * Material's own `mat-date-range-input`. Only the composite speaks the Form
 * Value Contract (the leaves are driven through `value`/`valueChange`, never
 * bound to a form), and only the composite is hosted by a form field
 * (`inlineMatFormField` on it, never on a leaf). It hands its leaves what a
 * hosted control gets: bare chrome (their `:host-context` rules follow its
 * host classes), `externalErrors` and the `overlayOrigin`. Its own host is
 * the `role="group"` — named by the form field's label (`labelledBy`), else
 * by `ariaLabel` — and the leaves are the group's parts.
 */
@Component({
  selector: 'angular-inline-datetime',
  imports: [
    // Components
    AngularInlineDate,
    AngularInlineTime,
  ],
  templateUrl: './angular-inline-datetime.html',
  styleUrl: './angular-inline-datetime.scss',
  // The form-field adapter's one way in (`inlineMatFormField`, /temporal-mat).
  providers: [
    // Tokens
    { provide: INLINE_TEMPORAL_MAT_CONTROL, useExisting: AngularInlineDateTime },
  ],
  host: {
    // Attributes
    // The group Material's own `mat-date-range-input` is: the hosting form
    // field's label names it, else `ariaLabel`; the leaves are its parts.
    role: 'group',
    '[attr.aria-labelledby]': 'labelledBy()',
    '[attr.aria-label]': 'labelledBy() ? null : ariaLabel()',

    // Styles
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDateTime implements FormValueControl<DbDateTime | null> {
  /** The committed value channel: a UTC ISO DB entry, or `null`. */
  value = model<DbDateTime | null>(null);

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  /**
   * Accessible base name. Each leaf is named as a PART of it through
   * `TemporalIntl.partLabel` ("Meeting date" / "Meeting time"); unset, the
   * leaves keep their own names ("Date" / "Time").
   */
  ariaLabel = input<string | undefined>(undefined);

  #intl = inject(TemporalIntl);

  protected dateAriaLabel = computed(() => this.#partLabel(this.#intl.dateLabel()));
  protected timeAriaLabel = computed(() => this.#partLabel(this.#intl.timeLabel()));

  #partLabel(noun: string): string {
    const base = this.ariaLabel();
    return base === undefined ? noun : this.#intl.partLabel(base, noun);
  }

  /**
   * Consumer clear affordance — forwarded to BOTH leaves, which own their own
   * bubbles. Each leaf stamps it with its own context, so one template serves
   * the pair (the labels say which: "Clear date" / "Clear time").
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  /** Locale override for both leaves. */
  locale = input<string | string[] | undefined>(undefined);

  /** The DISPLAY ZONE (IANA id) — `INLINE_TEMPORAL_ZONE`, then machine zone. */
  zone = input<string | undefined>(undefined);

  #zoneDefault = inject(INLINE_TEMPORAL_ZONE, { optional: true });

  readonly effectiveZone = computed(() => this.zone() ?? this.#zoneDefault?.());

  /** Which days the date leaf's calendar offers — forwarded as its `dayFilter`. */
  dayFilter = input<((iso: IsoDate) => boolean) | undefined>(undefined);

  /** The calendar grid affordance on the date leaf. */
  showCalendar = input(true);

  /** Native time-picker bounds, forwarded to the time leaf. */
  pickerMin = input<string | undefined>(undefined);
  pickerMax = input<string | undefined>(undefined);

  /** Reference clock — injectable for tests. */
  now = input<() => Date>(() => new Date());

  /** Form Value Contract: touch — either leaf touching bubbles up. */
  touch = output<void>();

  /** One commit event per settled leaf session that changed the instant. */
  savedModelChange = output<{ value: DbDateTime | null }>();

  /**
   * Set by a hosting form field, whose error area speaks: the time leaf's own
   * error overlay stays closed. Forwarded to the leaf.
   */
  externalErrors = model(false);

  /** Set by a hosting form field: the date leaf's calendar drops below its box. Forwarded to the leaf. */
  overlayOrigin = model<ElementRef<HTMLElement> | HTMLElement | null>(null);

  /** Set by a hosting form field: its label's id, which then names this group; unset, `ariaLabel` does. */
  labelledBy = model<string | null>(null);

  protected dateLeaf = viewChild(AngularInlineDate);
  protected timeLeaf = viewChild(AngularInlineTime);

  /** The DATE leaf's value — the calendar date the instant falls on in the display zone. */
  protected dateLeafValue = computed(() => localDayOf(this.value(), this.effectiveZone()));

  /** The leaves' own contract rules — the composite shows errors exactly when a leaf would. */
  #contract = makeLeafContract({
    disabled: this.disabled,
    readonly: this.readonly,
    touched: this.touched,
    invalid: this.invalid,
    errors: this.errors,
  });

  protected effectiveReadonly = this.#contract.readonly;

  /** The date leaf's LIVE channel: the typed day moves the instant, wall-clock kept. */
  protected handleDateValue(raw: unknown) {
    // The leaf is single-mode: its value is a string (or null on clear).
    if (raw === null) {
      if (this.value() !== null) this.value.set(null);
      return;
    }
    if (!isIsoDate(raw)) return;

    const zone = this.effectiveZone();
    const current = this.value();
    const next =
      current === null ? composeDbEntry(raw, '00:00', zone) : moveDbEntryToDay(current, raw, zone);

    if (next !== current) this.value.set(next);
  }

  /** The time leaf's LIVE channel: it edits the instant directly. */
  protected handleTimeValue(instant: unknown) {
    // The leaf is single-mode: its value is a DB entry string (or null).
    const next = typeof instant === 'string' ? instant : null;
    if (next !== this.value()) this.value.set(next);
  }

  /** Either leaf settled with a change — ONE composed commit. */
  protected handleLeafCommit() {
    this.savedModelChange.emit({ value: this.value() });
  }

  /** Either leaf touched — the composite counts as touched, and says so. */
  protected handleLeafTouch() {
    this.#contract.markTouched();
    this.touch.emit();
  }

  // -- The mat-adapter contract (composed from the leaves' public surface) -----

  readonly isEmpty = computed(() => this.value() === null);
  readonly effectiveDisabled = this.#contract.disabled;
  readonly errorsVisible = this.#contract.errorsVisible;
  readonly placeholderText = computed(() =>
    [this.dateLeaf()?.placeholderText(), this.timeLeaf()?.placeholderText()]
      .filter(Boolean)
      .join(' '),
  );
  readonly editing = computed(
    () => (this.dateLeaf()?.editing() || this.timeLeaf()?.editing()) ?? false,
  );
  readonly panelVisible = computed(
    () => (this.dateLeaf()?.panelVisible() || this.timeLeaf()?.panelVisible()) ?? false,
  );

  togglePanel() {
    this.dateLeaf()?.togglePanel();
  }

  focus(options?: FocusOptions) {
    this.dateLeaf()?.focus(options);
  }
}
