import {
  Directive,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormField, type ValidationError } from '@angular/forms/signals';

import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { toInternalRange } from '../angular-inline-date/date-codec';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { INLINE_TIME_DAY_OFFSET } from '../angular-inline-time/day-offset';
import { AngularInlineDuration } from '../angular-inline-duration/angular-inline-duration';
import {
  INLINE_TEMPORAL_BUBBLE_SIDE,
  INLINE_TEMPORAL_LEAF_STATE,
  type TemporalLeafState,
} from '../leaf-state';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';
import {
  addLocalDays,
  composeDbEntry,
  dayToDbEntry,
  dayEndToDbEntry,
  diffDbEntrySeconds,
  localDayDiff,
  localDayOf,
  localTimeOf,
  rollDbEntryForward,
  shiftDbEntry,
  type DbDateTime,
} from '../datetime/db-entry';

/**
 * The group's composed DATE value: the stay's day boundaries as DB entries
 * (`startOf('day')` … `endOf('day')`, over-count intrinsic to the end).
 */
export interface ComposedDateRange {
  start: DbDateTime;
  end: DbDateTime;
}

/** The group's composed TIME value: both endpoint instants as DB entries. */
export interface ComposedTimeRange {
  start: DbDateTime;
  end: DbDateTime;
}

function sameRange(
  a: { start: string; end: string } | null,
  b: { start: string; end: string } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

/**
 * The group's OWN form value — the domain shape the server speaks
 * (`DomainResult['model']` without the redundant `date`): DB entries +
 * seconds. `duration` is SHAPE-ECHOED: bind `{ start, end }` and it stays
 * internal-only; it is always computed inside and can never disagree with
 * the range.
 */
export interface TemporalRangeValue {
  start: DbDateTime | null;
  end: DbDateTime | null;
  duration?: number | null;
}

function sameTemporalValue(
  a: TemporalRangeValue | null,
  b: TemporalRangeValue | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end && a.duration === b.duration;
}

const NO_ERRORS = signal<readonly ValidationError.WithOptionalFieldTree[]>([]).asReadonly();

/**
 * T5's group core: links SEPARATE temporal controls — a date (`rangeDay`),
 * two times (`rangeStart`/`rangeEnd`) and a duration (`rangeLength`) — via
 * DI. Every value is a UTC ISO DB entry (iusta's `toDBEntry`), so the
 * datetimes are REAL and the invariants are plain arithmetic — the sandbox
 * mirror of iusta's `shiftFromDuration`/`induceFromTimeRange`:
 *
 * - Committing a start or end induces the duration (`end − start`); an end
 *   instant at or before the start rolls forward by whole days until it
 *   follows the start — the overnight case lands IN the value.
 * - Committing a duration MOVES the end (`end = start + duration`).
 * - Committing the day shifts BOTH times onto it, preserving wall-clock
 *   times and the end's day over-count.
 * - The `+n` badge on the end field = the LOCAL calendar-day difference
 *   between the two instants — derived presentation, fed through
 *   `INLINE_TIME_DAY_OFFSET`, never state of its own.
 * - Propagation happens on COMMIT (`saved`), never on live keystrokes:
 *   writes through `value` don't emit `saved`, so no cascades or cycles.
 *
 * Deliberately still open here (see ROADMAP-DATETIME): Tab-advance
 * start → end, ISO-datetime paste decomposition, the calendar drag /
 * Ctrl+click gestures (need T2), and the maximal end-day field.
 */
@Directive({
  selector: '[dateTimeRangeGroup]',
  exportAs: 'dateTimeRangeGroup',
})
export class DateTimeRangeGroup {
  #day = signal<AngularInlineDate | null>(null);
  #endDay = signal<AngularInlineDate | null>(null);
  #start = signal<AngularInlineTime | null>(null);
  #end = signal<AngularInlineTime | null>(null);
  /** ONE ranged time control carrying BOTH endpoints (the `rangeTimes` role). */
  #times = signal<AngularInlineTime | null>(null);
  #length = signal<AngularInlineDuration | null>(null);

  /** Present when the GROUP carries the `[formField]` — form-bound mode. */
  #ownField = inject(FormField, { optional: true, self: true });

  /**
   * T6 — the DISPLAY ZONE the group's day arithmetic runs in. MUST agree
   * with the leaves' zones: set it once via `provideInlineTemporalZone`
   * (both group and leaves fall back to the token), or set the input on
   * the group AND every leaf.
   */
  zone = input<string | undefined>(undefined);

  #zoneDefault = inject(INLINE_TEMPORAL_ZONE, { optional: true });

  readonly effectiveZone = computed(() => this.zone() ?? this.#zoneDefault?.());

  /**
   * The group's OWN value channel. Outbound it always mirrors the composed
   * leaves (harmless when nobody listens); inbound it only pushes down when
   * the group is form-bound or the value is non-null — a `null` on an
   * unbound group is silence, not a clear, so per-leaf-bound legacy setups
   * stay untouched.
   */
  value = model<TemporalRangeValue | null>(null);

  /** Form Value Contract — forwarded down to the leaves via role-provided state. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  touched = input(false);
  invalid = input(false);

  /** Form Value Contract: touch — any leaf touching bubbles up as the group's. */
  touch = output<void>();

  /** One commit event for the whole range: the composed `{start, end, duration?}`. */
  savedModelChange = output<TemporalRangeValue | null>();

  /**
   * `duration` shape memory (the date control's `#lastShape` pattern):
   * a non-null bound value declares whether the key participates; `null`
   * remembers; cold start includes it (the `DomainResult['model']` shape).
   */
  #durationInShape = linkedSignal<TemporalRangeValue | null, boolean>({
    source: this.value,
    computation: (value, previous) =>
      value === null ? (previous?.value ?? true) : 'duration' in value,
  });

  /** The composed domain value read live off the leaves, in the echoed shape. */
  readonly composedValue = computed<TemporalRangeValue | null>(() => {
    const start = this.start();
    const end = this.end();
    const duration = this.length();
    if (start === null && end === null && duration === null) return null;

    return this.#durationInShape() ? { start, end, duration } : { start, end };
  });


  /** The stay's LOCAL calendar day, read off the date control. */
  readonly day = computed<string | null>(() => {
    const control = this.#day();
    if (!control) return null;

    const start = toInternalRange(control.value()).start;
    return start === null ? null : localDayOf(start, this.effectiveZone());
  });

  /** The END's LOCAL calendar day, read off the end-day control (T5 maximal form). */
  readonly endDay = computed<string | null>(() => {
    const control = this.#endDay();
    if (!control) return null;

    const start = toInternalRange(control.value()).start;
    return start === null ? null : localDayOf(start, this.effectiveZone());
  });

  /**
   * `end >= start` over the COMPOSED instants — REAL now that the end-day
   * field (and explicit ISO pastes) can produce violations; typed TIMES
   * still roll forward and can't. Routed to the END leaves, revealed by
   * their own touched machinery.
   */
  readonly orderingErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() => {
    const start = this.start();
    const end = this.end();
    // DB entries are fixed-width UTC ISO strings — lexicographic order IS
    // instant order.
    if (start !== null && end !== null && end < start) {
      return [{ kind: 'temporal-order', message: 'The end lies before the start.' }];
    }

    return [];
  });

  /**
   * The endpoint instants and duration, read live off the controls. Two
   * SINGLE-shape time leaves (`rangeStart`/`rangeEnd`) or ONE ranged pair
   * (`rangeTimes`) — read through the internal model, like `rangeDay` does.
   */
  readonly start = computed<DbDateTime | null>(
    () => this.#start()?.internalRange().start ?? this.#times()?.internalRange().start ?? null,
  );
  readonly end = computed<DbDateTime | null>(
    () => this.#end()?.internalRange().start ?? this.#times()?.internalRange().end ?? null,
  );
  readonly length = computed<number | null>(() => this.#length()?.value() ?? null);

  /**
   * The end field's `+n` badge: LOCAL calendar days between the two
   * instants — intrinsic to the values now that they carry their days.
   */
  readonly endDayOffset = computed(() => {
    const start = this.start();
    if (start === null) return 0;

    const end = this.end();
    if (end !== null) return Math.max(0, localDayDiff(start, end, this.effectiveZone()) ?? 0);

    const length = this.length();
    if (length !== null) return Math.max(0, localDayDiff(start, shiftDbEntry(start, length), this.effectiveZone()) ?? 0);

    return 0;
  });

  /** The composed DATE value: day boundaries as DB entries, over-count applied. */
  readonly dateRange = computed<ComposedDateRange | null>(() => {
    const zone = this.effectiveZone();
    const startDay = this.day() ?? (this.start() !== null ? localDayOf(this.start(), zone) : null);
    if (startDay === null) return null;

    return {
      start: dayToDbEntry(startDay, zone),
      end: dayEndToDbEntry(addLocalDays(startDay, this.endDayOffset()), zone),
    };
  });

  /** The composed TIME value: both endpoint instants, or `null` while incomplete. */
  readonly timeRange = computed<ComposedTimeRange | null>(() => {
    const start = this.start();
    const end = this.end();
    return start !== null && end !== null ? { start, end } : null;
  });

  /**
   * Composed emissions — the group speaks three values, each fired after
   * commit propagation whenever ITS composed value changed: the date range,
   * the time range (all UTC ISO DB entries), and the duration (seconds).
   */
  dateRangeChange = output<ComposedDateRange | null>();
  timeRangeChange = output<ComposedTimeRange | null>();
  durationChange = output<number | null>();

  // `undefined` = baseline not captured yet (never emitted-against).
  #lastDate: ComposedDateRange | null | undefined = undefined;
  #lastTime: ComposedTimeRange | null | undefined = undefined;
  #lastLength: number | null | undefined = undefined;

  constructor() {
    // Baseline the composed values once the initial bindings have settled,
    // so the first commit emits real deltas, not the seed state.
    effect(() => {
      const date = this.dateRange();
      const time = this.timeRange();
      const length = this.length();

      if (this.#lastDate === undefined) {
        this.#lastDate = date;
        this.#lastTime = time;
        this.#lastLength = length;
      }
    });

    // The TWO boundary effects of form-bound mode — both equality-guarded,
    // both one-directional, converging in a single pass (a group write
    // pushes down; the mirror reads back the same values and stops).

    // INBOUND: the form's value → the leaf surfaces.
    effect(() => {
      const value = this.value();
      if (this.#ownField === null && value === null) return;

      untracked(() => this.#pushDown(value));
    });

    // OUTBOUND: the leaves' live values → the group's value (live channel).
    effect(() => {
      const composed = this.composedValue();
      if (!sameTemporalValue(composed, untracked(this.value))) this.value.set(composed);
    });
  }

  /** Writes the bound value onto the leaf surfaces (no-ops on equal values). */
  #pushDown(value: TemporalRangeValue | null) {
    const start = value?.start ?? null;
    const end = value?.end ?? null;
    const duration =
      value === null
        ? null
        : value.duration !== undefined
          ? value.duration
          : start !== null && end !== null
            ? diffDbEntrySeconds(start, end)
            : null;

    this.#start()?.value.set(start);
    this.#end()?.value.set(end);
    // The ranged pair speaks the object shape — both endpoints in one value.
    this.#times()?.value.set(start === null && end === null ? null : { start, end });
    this.#length()?.value.set(duration);
    this.#day()?.value.set(start === null ? null : dayToDbEntry(localDayOf(start, this.effectiveZone())!, this.effectiveZone()));
    this.#endDay()?.value.set(end === null ? null : dayToDbEntry(localDayOf(end, this.effectiveZone())!, this.effectiveZone()));
  }

  /**
   * The day leaves are RENDERINGS of the instants' date parts — after any
   * propagation that may have moved an instant's day (an ISO paste, a
   * multi-day duration, an end-day commit), they re-mirror. Writes go
   * through `value` (no `saved`), equality-guarded: no cascades.
   */
  #syncDayLeaves() {
    const start = this.start();
    const dayControl = this.#day();
    if (dayControl && start !== null) {
      const day = dayToDbEntry(localDayOf(start, this.effectiveZone())!, this.effectiveZone());
      if (!Object.is(dayControl.value(), day)) dayControl.value.set(day);
    }

    const end = this.end();
    const endDayControl = this.#endDay();
    if (endDayControl && end !== null) {
      const day = dayToDbEntry(localDayOf(end, this.effectiveZone())!, this.effectiveZone());
      if (!Object.is(endDayControl.value(), day)) endDayControl.value.set(day);
    }
  }

  #emitChanges() {
    this.#syncDayLeaves();

    let changed = false;

    const date = this.dateRange();
    if (this.#lastDate === undefined || !sameRange(date, this.#lastDate)) {
      this.#lastDate = date;
      this.dateRangeChange.emit(date);
      changed = true;
    }

    const time = this.timeRange();
    if (this.#lastTime === undefined || !sameRange(time, this.#lastTime)) {
      this.#lastTime = time;
      this.timeRangeChange.emit(time);
      changed = true;
    }

    const length = this.length();
    if (this.#lastLength === undefined || length !== this.#lastLength) {
      this.#lastLength = length;
      this.durationChange.emit(length);
      changed = true;
    }

    if (!changed) return;

    // The composite commit: value settles synchronously (the outbound
    // mirror then finds it equal), one savedModelChange for the range.
    const composed = this.composedValue();
    if (!sameTemporalValue(composed, this.value())) this.value.set(composed);
    this.savedModelChange.emit(composed);
  }

  // -- Registration (the role directives call these) --------------------------

  /** Mixed mode is a bug: a field-bound leaf inside a field-bound group throws. */
  #registerBinding(leafBound: boolean, role: string) {
    if (leafBound && this.#ownField !== null) {
      throw new Error(
        `DateTimeRangeGroup: the ${role} leaf has its own [formField] inside a ` +
          `form-bound group — bind EITHER the group (composed {start, end, duration}) ` +
          `OR the leaves, never both.`,
      );
    }
  }

  attachDay(control: AngularInlineDate, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeDay');
    this.#day.set(control);
  }
  attachEndDay(control: AngularInlineDate, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeEndDay');
    this.#endDay.set(control);
  }
  attachStart(control: AngularInlineTime, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeStart');
    this.#start.set(control);
  }
  attachEnd(control: AngularInlineTime, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeEnd');
    this.#end.set(control);
  }
  attachTimes(control: AngularInlineTime, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeTimes');
    this.#times.set(control);
  }
  attachLength(control: AngularInlineDuration, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeLength');
    this.#length.set(control);
  }

  // -- Commit propagation ------------------------------------------------------

  /** Rolls `end` forward by whole LOCAL days until it strictly follows `start`, then induces. */
  #induceFrom(start: DbDateTime, end: DbDateTime) {
    end = rollDbEntryForward(start, end, this.effectiveZone());

    this.#writeEnd(end);
    this.#writeLength(diffDbEntrySeconds(start, end)!);
  }

  /**
   * The start settled — `induceFromTimeRange`: duration follows from the
   * instants as they stand (multi-day ends survive); with no end but a
   * duration, the end is filled from `start + duration`.
   */
  startCommitted() {
    const start = this.start();

    if (start !== null) {
      const end = this.end();

      if (end !== null) {
        this.#induceFrom(start, end);
      } else {
        const length = this.length();
        if (length !== null) this.#writeEnd(shiftDbEntry(start, length));
      }
    }

    this.#emitChanges();
  }

  /**
   * The end settled: a typed end time is WALL-CLOCK intent — re-anchor it
   * onto the start's own day first, then roll forward while it does not
   * follow the start (`23:30` lands the same evening, `06:00` the next
   * morning), then induce the duration. A typed OVERFLOW (`'24:30'` → +1,
   * `'240:30'` → +10) is an explicit over-count: it anchors on the start's
   * day directly.
   */
  endCommitted(dayOverflow = 0, explicitDay = false) {
    const start = this.start();
    const end = this.end();

    if (start !== null && end !== null) {
      if (explicitDay) {
        // A pasted full instant IS the end — no re-anchor, no roll. An end
        // before the start stands as the ORDERING ERROR; the duration is
        // then underivable.
        const diff = diffDbEntrySeconds(start, end)!;
        this.#writeLength(diff > 0 ? diff : null);
      } else {
        const day = addLocalDays(localDayOf(start, this.effectiveZone())!, dayOverflow);
        this.#induceFrom(start, composeDbEntry(day, localTimeOf(end, this.effectiveZone())!, this.effectiveZone()));
      }
    }

    this.#emitChanges();
  }

  /**
   * The END-DAY settled (the maximal five-field form): the end instant
   * moves onto the typed day preserving its wall-clock time — deliberately
   * WITHOUT rolling forward. An end before the start is a legitimate ERROR
   * state now (the ordering error on the end leaves), and the duration is
   * underivable (`null` — never a stale one).
   */
  endDayCommitted() {
    const day = this.endDay();
    const end = this.end();

    if (day !== null && end !== null) {
      this.#writeEnd(composeDbEntry(day, localTimeOf(end, this.effectiveZone())!, this.effectiveZone()));

      const start = this.start();
      if (start !== null) {
        const diff = diffDbEntrySeconds(start, this.end()!)!;
        this.#writeLength(diff > 0 ? diff : null);
      }
    }

    this.#emitChanges();
  }

  /** A duration settled — `shiftFromDuration`: the end MOVES (`start + duration`). */
  lengthCommitted() {
    const start = this.start();
    const length = this.length();
    if (start !== null && length !== null) this.#writeEnd(shiftDbEntry(start, length));

    this.#emitChanges();
  }

  /**
   * The day settled: shift BOTH instants onto it — wall-clock times and
   * the end's day over-count are preserved.
   */
  dayCommitted() {
    const day = this.day();

    if (day !== null) {
      const start = this.start();
      const end = this.end();
      const offset = start !== null && end !== null ? Math.max(0, localDayDiff(start, end, this.effectiveZone()) ?? 0) : 0;

      if (start !== null) {
        this.#writeStart(composeDbEntry(day, localTimeOf(start, this.effectiveZone())!, this.effectiveZone()));
      }
      if (end !== null) {
        this.#writeEnd(
          composeDbEntry(addLocalDays(day, offset), localTimeOf(end, this.effectiveZone())!, this.effectiveZone()),
        );
      }
    }

    this.#emitChanges();
  }

  #writeStart(value: DbDateTime) {
    const control = this.#start();
    if (control && control.value() !== value) control.value.set(value);

    const times = this.#times();
    if (times && times.internalRange().start !== value) {
      times.value.set({ start: value, end: times.internalRange().end });
    }
  }

  #writeEnd(value: DbDateTime) {
    const control = this.#end();
    if (control && control.value() !== value) control.value.set(value);

    const times = this.#times();
    if (times && times.internalRange().end !== value) {
      times.value.set({ start: times.internalRange().start, end: value });
    }
  }

  #writeLength(value: number | null) {
    const control = this.#length();
    if (control && control.value() !== value) control.value.set(value);
  }
}

/**
 * The role-provided leaf state (the day-offset pattern): the group's
 * contract inputs, pulled by the leaf via a per-element token — no
 * effects, no writes. Ordering/range errors route to the END leaf only.
 */
function provideLeafState(withErrors: boolean) {
  return {
    provide: INLINE_TEMPORAL_LEAF_STATE,
    useFactory: (): TemporalLeafState => {
      const group = inject(DateTimeRangeGroup);
      return {
        disabled: group.disabled,
        readonly: group.readonly,
        touched: group.touched,
        invalid: group.invalid,
        // Consumer errors + the group's OWN ordering verdict, end leaves only.
        errors: withErrors
          ? computed(() => [...group.errors(), ...group.orderingErrors()])
          : NO_ERRORS,
      };
    },
  };
}

/** Whether THIS leaf element carries its own `[formField]` (legacy per-leaf mode). */
const leafHasOwnField = () => inject(FormField, { optional: true, self: true }) !== null;

/**
 * Marks the group's date control: `<angular-inline-date rangeDay />`. The
 * pair's inline-START leaf — its clear bubble opens outward (leftward) by
 * default via `INLINE_TEMPORAL_BUBBLE_SIDE`.
 */
@Directive({
  selector: 'angular-inline-date[rangeDay]',
  providers: [provideLeafState(false), { provide: INLINE_TEMPORAL_BUBBLE_SIDE, useValue: 'start' }],
})
export class RangeDay {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineDate);

    group.attachDay(control, leafHasOwnField());
    control.touch.subscribe(() => group.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) group.dayCommitted();
    });
  }
}

/**
 * Marks the group's start time: `<angular-inline-time rangeStart />`. An
 * inline-START leaf — its clear bubble opens outward (leftward) by default
 * via `INLINE_TEMPORAL_BUBBLE_SIDE`.
 */
@Directive({
  selector: 'angular-inline-time[rangeStart]',
  providers: [provideLeafState(false), { provide: INLINE_TEMPORAL_BUBBLE_SIDE, useValue: 'start' }],
})
export class RangeStart {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineTime);

    group.attachStart(control, leafHasOwnField());
    control.touch.subscribe(() => group.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) group.startCommitted();
    });
  }
}

/**
 * Marks the group's end time: `<angular-inline-time rangeEnd />`. Also
 * feeds the control's `+n` day-overflow badge via `INLINE_TIME_DAY_OFFSET`
 * and receives the group's range errors.
 */
@Directive({
  selector: 'angular-inline-time[rangeEnd]',
  providers: [
    provideLeafState(true),
    {
      provide: INLINE_TIME_DAY_OFFSET,
      useFactory: () => inject(DateTimeRangeGroup).endDayOffset,
    },
  ],
})
export class RangeEnd {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineTime);

    group.attachEnd(control, leafHasOwnField());
    control.touch.subscribe(() => group.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) group.endCommitted(session.dayOverflow, session.explicitDay);
    });
  }
}

/**
 * Marks ONE ranged time control carrying BOTH endpoints:
 * `<angular-inline-time [ranged]="true" rangeTimes />` — the pair replaces
 * the two single `rangeStart`/`rangeEnd` leaves (the add-dialog / table
 * TIME-column shape). Propagation stays per-endpoint: the control's
 * `saved.side` dispatches to the same start/end commit laws. The control
 * rolls and badges internally already — the group's re-anchor/roll is
 * idempotent over a settled pair (that is what `dayOverflow`/
 * `explicitDay` are carried FOR). Receives the group's range errors.
 */
@Directive({ selector: 'angular-inline-time[rangeTimes]', providers: [provideLeafState(true)] })
export class RangeTimes {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineTime);

    group.attachTimes(control, leafHasOwnField());
    control.touch.subscribe(() => group.touch.emit());
    control.saved.subscribe((session) => {
      if (!session.changed) return;
      if (session.side === 'start') group.startCommitted();
      else group.endCommitted(session.dayOverflow, session.explicitDay);
    });
  }
}

/**
 * Marks the group's END-DAY control (the maximal five-field form):
 * `<angular-inline-date rangeEndDay />`. Receives the ordering errors —
 * this leaf is where violations are made.
 */
@Directive({ selector: 'angular-inline-date[rangeEndDay]', providers: [provideLeafState(true)] })
export class RangeEndDay {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineDate);

    group.attachEndDay(control, leafHasOwnField());
    control.touch.subscribe(() => group.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) group.endDayCommitted();
    });
  }
}

/** Marks the group's duration: `<angular-inline-duration rangeLength />`. */
@Directive({
  selector: 'angular-inline-duration[rangeLength]',
  providers: [provideLeafState(false)],
})
export class RangeLength {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineDuration);

    group.attachLength(control, leafHasOwnField());
    control.touch.subscribe(() => group.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) group.lengthCommitted();
    });
  }
}
