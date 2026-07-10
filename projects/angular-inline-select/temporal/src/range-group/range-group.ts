import {
  Directive,
  InjectionToken,
  Injector,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
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

// =============================================================================
// The HEADLESS core — the laws as a plain factory (no directive, no OOP)
// =============================================================================

/**
 * One commit propagation's outcome — handed to `onChanges` exactly once per
 * settled leaf session that moved ANY composed value. Each `*Changed` flag
 * says whether THAT stream moved; `composed` is the settled group value.
 */
export interface TemporalRangeChanges {
  dateRange: ComposedDateRange | null;
  dateRangeChanged: boolean;
  timeRange: ComposedTimeRange | null;
  timeRangeChanged: boolean;
  duration: number | null;
  durationChanged: boolean;
  composed: TemporalRangeValue | null;
}

export interface TemporalRangeGroupOptions {
  /**
   * Bring your own value channel (the directive passes its `value` model);
   * omitted, the group owns a fresh `signal(null)` — read/write it via
   * `group.value`.
   */
  value?: WritableSignal<TemporalRangeValue | null>;
  /** The display zone the day arithmetic runs in (a signal or thunk). */
  zone?: () => string | undefined;
  /**
   * Form-BOUND mode: inbound `null` values push down (a bound field's null
   * is a real clear). Unbound (the default), `null` is silence — per-leaf
   * legacy setups stay untouched.
   */
  bound?: boolean;
  /** Fired once per commit propagation that changed any composed value. */
  onChanges?: (changes: TemporalRangeChanges) => void;
  /**
   * The factory registers `effect`s — call it in an injection context or
   * pass the injector explicitly (row data built outside one, e.g. in a
   * resource loader).
   */
  injector?: Injector;
}

/**
 * The headless range group: `createTemporalRangeGroup()`'s return — the
 * SAME laws as the `dateTimeRangeGroup` directive, detached from DI so it
 * can live on ROW DATA. Leaves connect BY REFERENCE through the role
 * attributes (`[rangeDay]="row.group"` …), which makes `matColumnDef`'s
 * DI scoping irrelevant — the mat-table case the directive cannot serve.
 */
export interface TemporalRangeGroup {
  /** The group's value channel (the composed `{ start, end, duration? }`). */
  readonly value: WritableSignal<TemporalRangeValue | null>;

  // Live readings off the attached leaves.
  readonly day: Signal<string | null>;
  readonly endDay: Signal<string | null>;
  readonly start: Signal<DbDateTime | null>;
  readonly end: Signal<DbDateTime | null>;
  readonly length: Signal<number | null>;
  readonly endDayOffset: Signal<number>;
  readonly dateRange: Signal<ComposedDateRange | null>;
  readonly timeRange: Signal<ComposedTimeRange | null>;
  readonly composedValue: Signal<TemporalRangeValue | null>;
  readonly orderingErrors: Signal<readonly ValidationError.WithOptionalFieldTree[]>;

  // Attachment (the role directives call these; by reference, no DI).
  attachDay(control: AngularInlineDate): void;
  attachEndDay(control: AngularInlineDate): void;
  attachStart(control: AngularInlineTime): void;
  attachEnd(control: AngularInlineTime): void;
  attachTimes(control: AngularInlineTime): void;
  attachLength(control: AngularInlineDuration): void;

  // The commit laws (dispatched from the leaves' `saved` sessions).
  dayCommitted(): void;
  startCommitted(): void;
  endCommitted(dayOverflow?: number, explicitDay?: boolean): void;
  endDayCommitted(): void;
  lengthCommitted(): void;
}

/**
 * The group core as a PLAIN FACTORY — signals + attach/commit functions,
 * living wherever the caller puts it (typically on row data). Links
 * SEPARATE temporal controls — a date (`rangeDay`), two times
 * (`rangeStart`/`rangeEnd`) or ONE ranged pair (`rangeTimes`), and a
 * duration (`rangeLength`). Every value is a UTC ISO DB entry (iusta's
 * `toDBEntry`), so the datetimes are REAL and the invariants are plain
 * arithmetic — the mirror of iusta's `shiftFromDuration`/
 * `induceFromTimeRange`:
 *
 * - Committing a start or end induces the duration (`end − start`); an end
 *   instant at or before the start rolls forward by whole days until it
 *   follows the start — the overnight case lands IN the value.
 * - Committing a duration MOVES the end (`end = start + duration`).
 * - Committing the day shifts BOTH times onto it, preserving wall-clock
 *   times and the end's day over-count.
 * - The `+n` badge on the end field = the LOCAL calendar-day difference
 *   between the two instants — derived presentation, never state.
 * - Propagation happens on COMMIT (the leaves' `saved` sessions carry the
 *   intent — `dayOverflow`/`explicitDay` — that values alone don't), never
 *   on live keystrokes: writes through `value` don't emit `saved`, so no
 *   cascades or cycles.
 */
export function createTemporalRangeGroup(
  options: TemporalRangeGroupOptions = {},
): TemporalRangeGroup {
  const injector = options.injector ?? inject(Injector);
  const value = options.value ?? signal<TemporalRangeValue | null>(null);
  const zone = options.zone ?? (() => undefined);
  const bound = options.bound ?? false;

  const dayCtl = signal<AngularInlineDate | null>(null);
  const endDayCtl = signal<AngularInlineDate | null>(null);
  const startCtl = signal<AngularInlineTime | null>(null);
  const endCtl = signal<AngularInlineTime | null>(null);
  /** ONE ranged time control carrying BOTH endpoints (the `rangeTimes` role). */
  const timesCtl = signal<AngularInlineTime | null>(null);
  const lengthCtl = signal<AngularInlineDuration | null>(null);

  /**
   * `duration` shape memory (the date control's `#lastShape` pattern):
   * a non-null bound value declares whether the key participates; `null`
   * remembers; cold start includes it (the `DomainResult['model']` shape).
   */
  const durationInShape = linkedSignal<TemporalRangeValue | null, boolean>({
    source: value,
    computation: (current, previous) =>
      current === null ? (previous?.value ?? true) : 'duration' in current,
  });

  /** The stay's LOCAL calendar day, read off the date control. */
  const day = computed<string | null>(() => {
    const control = dayCtl();
    if (!control) return null;

    const start = toInternalRange(control.value()).start;
    return start === null ? null : localDayOf(start, zone());
  });

  /** The END's LOCAL calendar day, read off the end-day control (the maximal form). */
  const endDay = computed<string | null>(() => {
    const control = endDayCtl();
    if (!control) return null;

    const start = toInternalRange(control.value()).start;
    return start === null ? null : localDayOf(start, zone());
  });

  /**
   * The endpoint instants and duration, read live off the controls. Two
   * SINGLE-shape time leaves (`rangeStart`/`rangeEnd`) or ONE ranged pair
   * (`rangeTimes`) — read through the internal model, like `rangeDay` does.
   */
  const start = computed<DbDateTime | null>(
    () => startCtl()?.internalRange().start ?? timesCtl()?.internalRange().start ?? null,
  );
  const end = computed<DbDateTime | null>(
    () => endCtl()?.internalRange().start ?? timesCtl()?.internalRange().end ?? null,
  );
  const length = computed<number | null>(() => lengthCtl()?.value() ?? null);

  /** The composed domain value read live off the leaves, in the echoed shape. */
  const composedValue = computed<TemporalRangeValue | null>(() => {
    const startValue = start();
    const endValue = end();
    const duration = length();
    if (startValue === null && endValue === null && duration === null) return null;

    return durationInShape()
      ? { start: startValue, end: endValue, duration }
      : { start: startValue, end: endValue };
  });

  /**
   * `end >= start` over the COMPOSED instants — REAL now that the end-day
   * field (and explicit ISO pastes) can produce violations; typed TIMES
   * still roll forward and can't. Routed to the END leaves, revealed by
   * their own touched machinery.
   */
  const orderingErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() => {
    const startValue = start();
    const endValue = end();
    // DB entries are fixed-width UTC ISO strings — lexicographic order IS
    // instant order.
    if (startValue !== null && endValue !== null && endValue < startValue) {
      return [{ kind: 'temporal-order', message: 'The end lies before the start.' }];
    }

    return [];
  });

  /**
   * The end field's `+n` badge: LOCAL calendar days between the two
   * instants — intrinsic to the values now that they carry their days.
   */
  const endDayOffset = computed(() => {
    const startValue = start();
    if (startValue === null) return 0;

    const endValue = end();
    if (endValue !== null) {
      return Math.max(0, localDayDiff(startValue, endValue, zone()) ?? 0);
    }

    const duration = length();
    if (duration !== null) {
      return Math.max(
        0,
        localDayDiff(startValue, shiftDbEntry(startValue, duration), zone()) ?? 0,
      );
    }

    return 0;
  });

  /** The composed DATE value: day boundaries as DB entries, over-count applied. */
  const dateRange = computed<ComposedDateRange | null>(() => {
    const startDay = day() ?? (start() !== null ? localDayOf(start(), zone()) : null);
    if (startDay === null) return null;

    return {
      start: dayToDbEntry(startDay, zone()),
      end: dayEndToDbEntry(addLocalDays(startDay, endDayOffset()), zone()),
    };
  });

  /** The composed TIME value: both endpoint instants, or `null` while incomplete. */
  const timeRange = computed<ComposedTimeRange | null>(() => {
    const startValue = start();
    const endValue = end();
    return startValue !== null && endValue !== null
      ? { start: startValue, end: endValue }
      : null;
  });

  // -- Write helpers -----------------------------------------------------------

  function writeStart(next: DbDateTime) {
    const control = startCtl();
    if (control && control.value() !== next) control.value.set(next);

    const times = timesCtl();
    if (times && times.internalRange().start !== next) {
      times.value.set({ start: next, end: times.internalRange().end });
    }
  }

  function writeEnd(next: DbDateTime) {
    const control = endCtl();
    if (control && control.value() !== next) control.value.set(next);

    const times = timesCtl();
    if (times && times.internalRange().end !== next) {
      times.value.set({ start: times.internalRange().start, end: next });
    }
  }

  function writeLength(next: number | null) {
    const control = lengthCtl();
    if (control && control.value() !== next) control.value.set(next);
  }

  /** Writes the bound value onto the leaf surfaces (no-ops on equal values). */
  function pushDown(next: TemporalRangeValue | null) {
    const startValue = next?.start ?? null;
    const endValue = next?.end ?? null;
    const duration =
      next === null
        ? null
        : next.duration !== undefined
          ? next.duration
          : startValue !== null && endValue !== null
            ? diffDbEntrySeconds(startValue, endValue)
            : null;

    startCtl()?.value.set(startValue);
    endCtl()?.value.set(endValue);
    // The ranged pair speaks the object shape — both endpoints in one value.
    timesCtl()?.value.set(
      startValue === null && endValue === null ? null : { start: startValue, end: endValue },
    );
    lengthCtl()?.value.set(duration);
    dayCtl()?.value.set(
      startValue === null ? null : dayToDbEntry(localDayOf(startValue, zone())!, zone()),
    );
    endDayCtl()?.value.set(
      endValue === null ? null : dayToDbEntry(localDayOf(endValue, zone())!, zone()),
    );
  }

  /**
   * The day leaves are RENDERINGS of the instants' date parts — after any
   * propagation that may have moved an instant's day (an ISO paste, a
   * multi-day duration, an end-day commit), they re-mirror. Writes go
   * through `value` (no `saved`), equality-guarded: no cascades.
   */
  function syncDayLeaves() {
    const startValue = start();
    const dayControl = dayCtl();
    if (dayControl && startValue !== null) {
      const next = dayToDbEntry(localDayOf(startValue, zone())!, zone());
      if (!Object.is(dayControl.value(), next)) dayControl.value.set(next);
    }

    const endValue = end();
    const endDayControl = endDayCtl();
    if (endDayControl && endValue !== null) {
      const next = dayToDbEntry(localDayOf(endValue, zone())!, zone());
      if (!Object.is(endDayControl.value(), next)) endDayControl.value.set(next);
    }
  }

  // `undefined` = baseline not captured yet (never emitted-against).
  let lastDate: ComposedDateRange | null | undefined = undefined;
  let lastTime: ComposedTimeRange | null | undefined = undefined;
  let lastLength: number | null | undefined = undefined;

  function emitChanges() {
    syncDayLeaves();

    const date = dateRange();
    const dateChanged = lastDate === undefined || !sameRange(date, lastDate);
    lastDate = date;

    const time = timeRange();
    const timeChanged = lastTime === undefined || !sameRange(time, lastTime);
    lastTime = time;

    const duration = length();
    const durationChanged = lastLength === undefined || duration !== lastLength;
    lastLength = duration;

    if (!dateChanged && !timeChanged && !durationChanged) return;

    // The composite commit: value settles synchronously (the outbound
    // mirror then finds it equal), one `onChanges` for the range.
    const composed = composedValue();
    if (!sameTemporalValue(composed, value())) value.set(composed);
    options.onChanges?.({
      dateRange: date,
      dateRangeChanged: dateChanged,
      timeRange: time,
      timeRangeChanged: timeChanged,
      duration,
      durationChanged,
      composed,
    });
  }

  // -- Commit laws ---------------------------------------------------------------

  /** Rolls `end` forward by whole LOCAL days until it strictly follows `start`, then induces. */
  function induceFrom(startValue: DbDateTime, endValue: DbDateTime) {
    endValue = rollDbEntryForward(startValue, endValue, zone());

    writeEnd(endValue);
    writeLength(diffDbEntrySeconds(startValue, endValue)!);
  }

  /**
   * The start settled — `induceFromTimeRange`: duration follows from the
   * instants as they stand (multi-day ends survive); with no end but a
   * duration, the end is filled from `start + duration`.
   */
  function startCommitted() {
    const startValue = start();

    if (startValue !== null) {
      const endValue = end();

      if (endValue !== null) {
        induceFrom(startValue, endValue);
      } else {
        const duration = length();
        if (duration !== null) writeEnd(shiftDbEntry(startValue, duration));
      }
    }

    emitChanges();
  }

  /**
   * The end settled: a typed end time is WALL-CLOCK intent — re-anchor it
   * onto the start's own day first, then roll forward while it does not
   * follow the start (`23:30` lands the same evening, `06:00` the next
   * morning), then induce the duration. A typed OVERFLOW (`'24:30'` → +1,
   * `'240:30'` → +10) is an explicit over-count: it anchors on the start's
   * day directly.
   */
  function endCommitted(dayOverflow = 0, explicitDay = false) {
    const startValue = start();
    const endValue = end();

    if (startValue !== null && endValue !== null) {
      if (explicitDay) {
        // A pasted full instant IS the end — no re-anchor, no roll. An end
        // before the start stands as the ORDERING ERROR; the duration is
        // then underivable.
        const diff = diffDbEntrySeconds(startValue, endValue)!;
        writeLength(diff > 0 ? diff : null);
      } else {
        const anchoredDay = addLocalDays(localDayOf(startValue, zone())!, dayOverflow);
        induceFrom(startValue, composeDbEntry(anchoredDay, localTimeOf(endValue, zone())!, zone()));
      }
    }

    emitChanges();
  }

  /**
   * The END-DAY settled (the maximal five-field form): the end instant
   * moves onto the typed day preserving its wall-clock time — deliberately
   * WITHOUT rolling forward. An end before the start is a legitimate ERROR
   * state now (the ordering error on the end leaves), and the duration is
   * underivable (`null` — never a stale one).
   */
  function endDayCommitted() {
    const typedDay = endDay();
    const endValue = end();

    if (typedDay !== null && endValue !== null) {
      writeEnd(composeDbEntry(typedDay, localTimeOf(endValue, zone())!, zone()));

      const startValue = start();
      if (startValue !== null) {
        const diff = diffDbEntrySeconds(startValue, end()!)!;
        writeLength(diff > 0 ? diff : null);
      }
    }

    emitChanges();
  }

  /** A duration settled — `shiftFromDuration`: the end MOVES (`start + duration`). */
  function lengthCommitted() {
    const startValue = start();
    const duration = length();
    if (startValue !== null && duration !== null) writeEnd(shiftDbEntry(startValue, duration));

    emitChanges();
  }

  /**
   * The day settled: shift BOTH instants onto it — wall-clock times and
   * the end's day over-count are preserved.
   */
  function dayCommitted() {
    const typedDay = day();

    if (typedDay !== null) {
      const startValue = start();
      const endValue = end();
      const offset =
        startValue !== null && endValue !== null
          ? Math.max(0, localDayDiff(startValue, endValue, zone()) ?? 0)
          : 0;

      if (startValue !== null) {
        writeStart(composeDbEntry(typedDay, localTimeOf(startValue, zone())!, zone()));
      }
      if (endValue !== null) {
        writeEnd(
          composeDbEntry(
            addLocalDays(typedDay, offset),
            localTimeOf(endValue, zone())!,
            zone(),
          ),
        );
      }
    }

    emitChanges();
  }

  // -- Boundary effects ------------------------------------------------------------

  // Baseline the composed values once the initial bindings have settled,
  // so the first commit emits real deltas, not the seed state.
  effect(
    () => {
      const date = dateRange();
      const time = timeRange();
      const duration = length();

      if (lastDate === undefined) {
        lastDate = date;
        lastTime = time;
        lastLength = duration;
      }
    },
    { injector },
  );

  // The TWO boundary effects — both equality-guarded, both one-directional,
  // converging in a single pass (a value write pushes down; the mirror reads
  // back the same values and stops).

  // INBOUND: the value channel → the leaf surfaces. Attachment is a
  // dependency on purpose: by-reference leaves attach through an EFFECT
  // (after the first inbound flush), so a late-attaching leaf must receive
  // the current value — the directive's synchronous DI attach never needed
  // this.
  effect(
    () => {
      const next = value();
      dayCtl();
      endDayCtl();
      startCtl();
      endCtl();
      timesCtl();
      lengthCtl();
      if (!bound && next === null) return;

      untracked(() => pushDown(next));
    },
    { injector },
  );

  const anyAttached = computed(
    () =>
      dayCtl() !== null ||
      endDayCtl() !== null ||
      startCtl() !== null ||
      endCtl() !== null ||
      timesCtl() !== null ||
      lengthCtl() !== null,
  );

  // OUTBOUND: the leaves' live values → the value channel (live mirror).
  // Gated on attachment: with NO leaves yet (by-reference roles attach an
  // effect-flush later), the composed reading is an empty null that must
  // not clobber a seeded value.
  effect(
    () => {
      if (!anyAttached()) return;

      const composed = composedValue();
      if (!sameTemporalValue(composed, untracked(value))) value.set(composed);
    },
    { injector },
  );

  return {
    value,
    day,
    endDay,
    start,
    end,
    length,
    endDayOffset,
    dateRange,
    timeRange,
    composedValue,
    orderingErrors,
    attachDay: (control) => dayCtl.set(control),
    attachEndDay: (control) => endDayCtl.set(control),
    attachStart: (control) => startCtl.set(control),
    attachEnd: (control) => endCtl.set(control),
    attachTimes: (control) => timesCtl.set(control),
    attachLength: (control) => lengthCtl.set(control),
    dayCommitted,
    startCommitted,
    endCommitted,
    endDayCommitted,
    lengthCommitted,
  };
}

// =============================================================================
// The DI directive — a thin shell over the factory (the form-bound face)
// =============================================================================

/**
 * The group as a DIRECTIVE: `createTemporalRangeGroup`'s laws wearing the
 * form contract — one `[formField]` binds the composed
 * `{ start, end, duration? }`, contract state forwards to the leaves via
 * the role-provided leaf state, and the composed streams ride outputs.
 * Role attributes left BARE connect to this directive via DI; where DI
 * cannot reach (mat-table's `matColumnDef`), bind the headless group by
 * reference instead — `[rangeDay]="row.group"`.
 */
@Directive({
  selector: '[dateTimeRangeGroup]',
  exportAs: 'dateTimeRangeGroup',
})
export class DateTimeRangeGroup {
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
   * Composed emissions — the group speaks three values, each fired after
   * commit propagation whenever ITS composed value changed: the date range,
   * the time range (all UTC ISO DB entries), and the duration (seconds).
   */
  dateRangeChange = output<ComposedDateRange | null>();
  timeRangeChange = output<ComposedTimeRange | null>();
  durationChange = output<number | null>();

  /** The headless core carrying the laws — the directive is its form-bound face. */
  readonly core: TemporalRangeGroup = createTemporalRangeGroup({
    value: this.value,
    zone: this.effectiveZone,
    bound: this.#ownField !== null,
    onChanges: (changes) => {
      if (changes.dateRangeChanged) this.dateRangeChange.emit(changes.dateRange);
      if (changes.timeRangeChanged) this.timeRangeChange.emit(changes.timeRange);
      if (changes.durationChanged) this.durationChange.emit(changes.duration);
      this.savedModelChange.emit(changes.composed);
    },
  });

  // The public readings, delegated (API-compatible with the pre-factory group).
  readonly day = this.core.day;
  readonly endDay = this.core.endDay;
  readonly start = this.core.start;
  readonly end = this.core.end;
  readonly length = this.core.length;
  readonly endDayOffset = this.core.endDayOffset;
  readonly dateRange = this.core.dateRange;
  readonly timeRange = this.core.timeRange;
  readonly composedValue = this.core.composedValue;
  readonly orderingErrors = this.core.orderingErrors;

  // -- Registration (the role directives call these in DI mode) ----------------

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
    this.core.attachDay(control);
  }
  attachEndDay(control: AngularInlineDate, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeEndDay');
    this.core.attachEndDay(control);
  }
  attachStart(control: AngularInlineTime, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeStart');
    this.core.attachStart(control);
  }
  attachEnd(control: AngularInlineTime, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeEnd');
    this.core.attachEnd(control);
  }
  attachTimes(control: AngularInlineTime, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeTimes');
    this.core.attachTimes(control);
  }
  attachLength(control: AngularInlineDuration, leafBound = false) {
    this.#registerBinding(leafBound, 'rangeLength');
    this.core.attachLength(control);
  }

  // The commit laws, delegated (API compatibility).
  dayCommitted() {
    this.core.dayCommitted();
  }
  startCommitted() {
    this.core.startCommitted();
  }
  endCommitted(dayOverflow = 0, explicitDay = false) {
    this.core.endCommitted(dayOverflow, explicitDay);
  }
  endDayCommitted() {
    this.core.endDayCommitted();
  }
  lengthCommitted() {
    this.core.lengthCommitted();
  }
}

// =============================================================================
// The role directives — DI mode (bare attribute) or by-reference mode
// =============================================================================

/**
 * The role's RESOLVED core, as a per-element holder signal. An indirection
 * on purpose: the leaf-state / day-offset providers run while the CONTROL
 * constructs, so they must not inject the role directive (whose constructor
 * injects the control — NG0200). They read this holder instead; the role's
 * wiring fills it once resolution settles.
 */
const RANGE_ROLE_CORE = new InjectionToken<WritableSignal<TemporalRangeGroup | null>>(
  'RANGE_ROLE_CORE',
);

function provideRoleCore() {
  return { provide: RANGE_ROLE_CORE, useFactory: () => signal<TemporalRangeGroup | null>(null) };
}

/**
 * The role-provided leaf state (the day-offset pattern): the group's
 * contract inputs, pulled by the leaf via a per-element token — no
 * effects, no writes. Contract state exists only in DI (form-bound) mode;
 * ordering/range errors come from the RESOLVED core, so they reach the
 * END leaf in both modes.
 */
function provideLeafState(withErrors: boolean) {
  return {
    provide: INLINE_TEMPORAL_LEAF_STATE,
    useFactory: (): TemporalLeafState => {
      const group = inject(DateTimeRangeGroup, { optional: true });
      const core = inject(RANGE_ROLE_CORE, { self: true });
      return {
        disabled: computed(() => group?.disabled() ?? false),
        readonly: computed(() => group?.readonly() ?? false),
        touched: computed(() => group?.touched() ?? false),
        invalid: computed(() => group?.invalid() ?? false),
        // Consumer errors + the group's OWN ordering verdict, end leaves only.
        errors: withErrors
          ? computed(() => [
              ...(group?.errors() ?? []),
              ...(core()?.orderingErrors() ?? []),
            ])
          : NO_ERRORS,
      };
    },
  };
}

/** Whether THIS leaf element carries its own `[formField]` (legacy per-leaf mode). */
const leafHasOwnField = () => inject(FormField, { optional: true, self: true }) !== null;

/**
 * The shared role wiring: resolves the group (the role attribute's bound
 * reference wins over the DI directive), attaches the control to it as the
 * reference (re)binds, and dispatches the leaf's settled sessions into the
 * given commit law. DI mode attaches through the DIRECTIVE so the
 * mixed-mode guard keeps throwing.
 */
function wireRole<TControl>(
  reference: Signal<TemporalRangeGroup | '' | undefined>,
  control: TControl,
  attach: (core: TemporalRangeGroup) => void,
  attachViaDirective: (group: DateTimeRangeGroup, leafBound: boolean) => void,
): Signal<TemporalRangeGroup | null> {
  const di = inject(DateTimeRangeGroup, { optional: true });
  const holder = inject(RANGE_ROLE_CORE, { self: true });
  const leafBound = leafHasOwnField();

  const resolvedCore = computed<TemporalRangeGroup | null>(() => {
    const ref = reference();
    return typeof ref === 'object' && ref !== null ? ref : (di?.core ?? null);
  });

  // DI mode attaches SYNCHRONOUSLY (the mixed-mode guard must throw during
  // construction, exactly as before the factory existed); a bound reference
  // arrives with the first input flush and simply wins.
  let attached: TemporalRangeGroup | null = null;
  if (di !== null) {
    attached = di.core;
    holder.set(di.core);
    attachViaDirective(di, leafBound);
  }

  effect(() => {
    const core = resolvedCore();
    holder.set(core);
    if (core === null || core === attached) return;

    attached = core;
    if (di !== null && core === di.core) attachViaDirective(di, leafBound);
    else attach(core);
  });

  return resolvedCore;
}

/**
 * Marks the group's date control. Bare, it connects to the ancestor
 * `dateTimeRangeGroup` directive via DI: `<angular-inline-date rangeDay />`;
 * bound, it connects to a HEADLESS group by reference —
 * `<angular-inline-date [rangeDay]="row.group" />` (the mat-table case,
 * where `matColumnDef` blocks DI). The pair's inline-START leaf — its clear
 * bubble opens outward (leftward) by default via
 * `INLINE_TEMPORAL_BUBBLE_SIDE`.
 */
@Directive({
  selector: 'angular-inline-date[rangeDay]',
  providers: [
    provideRoleCore(),
    provideLeafState(false),
    { provide: INLINE_TEMPORAL_BUBBLE_SIDE, useValue: 'start' },
  ],
})
export class RangeDay {
  rangeDay = input<TemporalRangeGroup | ''>('');

  readonly resolvedCore: Signal<TemporalRangeGroup | null>;

  constructor() {
    const control = inject(AngularInlineDate);
    this.resolvedCore = wireRole(
      this.rangeDay,
      control,
      (core) => core.attachDay(control),
      (group, leafBound) => group.attachDay(control, leafBound),
    );

    const di = inject(DateTimeRangeGroup, { optional: true });
    control.touch.subscribe(() => di?.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) this.resolvedCore()?.dayCommitted();
    });
  }
}

/**
 * Marks the group's start time (DI via the bare attribute, a headless
 * group by reference — see `RangeDay`). An inline-START leaf — its clear
 * bubble opens outward (leftward) by default.
 */
@Directive({
  selector: 'angular-inline-time[rangeStart]',
  providers: [
    provideRoleCore(),
    provideLeafState(false),
    { provide: INLINE_TEMPORAL_BUBBLE_SIDE, useValue: 'start' },
  ],
})
export class RangeStart {
  rangeStart = input<TemporalRangeGroup | ''>('');

  readonly resolvedCore: Signal<TemporalRangeGroup | null>;

  constructor() {
    const control = inject(AngularInlineTime);
    this.resolvedCore = wireRole(
      this.rangeStart,
      control,
      (core) => core.attachStart(control),
      (group, leafBound) => group.attachStart(control, leafBound),
    );

    const di = inject(DateTimeRangeGroup, { optional: true });
    control.touch.subscribe(() => di?.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) this.resolvedCore()?.startCommitted();
    });
  }
}

/**
 * Marks the group's end time (DI via the bare attribute, a headless group
 * by reference — see `RangeDay`). Also feeds the control's `+n`
 * day-overflow badge via `INLINE_TIME_DAY_OFFSET` and receives the group's
 * range errors.
 */
@Directive({
  selector: 'angular-inline-time[rangeEnd]',
  providers: [
    provideRoleCore(),
    provideLeafState(true),
    {
      provide: INLINE_TIME_DAY_OFFSET,
      useFactory: () => {
        const core = inject(RANGE_ROLE_CORE, { self: true });
        return computed(() => core()?.endDayOffset() ?? 0);
      },
    },
  ],
})
export class RangeEnd {
  rangeEnd = input<TemporalRangeGroup | ''>('');

  readonly resolvedCore: Signal<TemporalRangeGroup | null>;

  constructor() {
    const control = inject(AngularInlineTime);
    this.resolvedCore = wireRole(
      this.rangeEnd,
      control,
      (core) => core.attachEnd(control),
      (group, leafBound) => group.attachEnd(control, leafBound),
    );

    const di = inject(DateTimeRangeGroup, { optional: true });
    control.touch.subscribe(() => di?.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) this.resolvedCore()?.endCommitted(session.dayOverflow, session.explicitDay);
    });
  }
}

/**
 * Marks ONE ranged time control carrying BOTH endpoints:
 * `<angular-inline-time [ranged]="true" rangeTimes />` (DI) or
 * `[rangeTimes]="row.group"` (headless, by reference) — the pair replaces
 * the two single `rangeStart`/`rangeEnd` leaves (the add-dialog / table
 * TIME-column shape). Propagation stays per-endpoint: the control's
 * `saved.side` dispatches to the same start/end commit laws. The control
 * rolls and badges internally already — the group's re-anchor/roll is
 * idempotent over a settled pair (that is what `dayOverflow`/
 * `explicitDay` are carried FOR). Receives the group's range errors.
 */
@Directive({
  selector: 'angular-inline-time[rangeTimes]',
  providers: [provideRoleCore(), provideLeafState(true)],
})
export class RangeTimes {
  rangeTimes = input<TemporalRangeGroup | ''>('');

  readonly resolvedCore: Signal<TemporalRangeGroup | null>;

  constructor() {
    const control = inject(AngularInlineTime);
    this.resolvedCore = wireRole(
      this.rangeTimes,
      control,
      (core) => core.attachTimes(control),
      (group, leafBound) => group.attachTimes(control, leafBound),
    );

    const di = inject(DateTimeRangeGroup, { optional: true });
    control.touch.subscribe(() => di?.touch.emit());
    control.saved.subscribe((session) => {
      if (!session.changed) return;
      const core = this.resolvedCore();
      if (core === null) return;
      if (session.side === 'start') core.startCommitted();
      else core.endCommitted(session.dayOverflow, session.explicitDay);
    });
  }
}

/**
 * Marks the group's END-DAY control (the maximal five-field form; DI via
 * the bare attribute, a headless group by reference — see `RangeDay`).
 * Receives the ordering errors — this leaf is where violations are made.
 */
@Directive({
  selector: 'angular-inline-date[rangeEndDay]',
  providers: [provideRoleCore(), provideLeafState(true)],
})
export class RangeEndDay {
  rangeEndDay = input<TemporalRangeGroup | ''>('');

  readonly resolvedCore: Signal<TemporalRangeGroup | null>;

  constructor() {
    const control = inject(AngularInlineDate);
    this.resolvedCore = wireRole(
      this.rangeEndDay,
      control,
      (core) => core.attachEndDay(control),
      (group, leafBound) => group.attachEndDay(control, leafBound),
    );

    const di = inject(DateTimeRangeGroup, { optional: true });
    control.touch.subscribe(() => di?.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) this.resolvedCore()?.endDayCommitted();
    });
  }
}

/**
 * Marks the group's duration (DI via the bare attribute, a headless group
 * by reference — see `RangeDay`).
 */
@Directive({
  selector: 'angular-inline-duration[rangeLength]',
  providers: [provideRoleCore(), provideLeafState(false)],
})
export class RangeLength {
  rangeLength = input<TemporalRangeGroup | ''>('');

  readonly resolvedCore: Signal<TemporalRangeGroup | null>;

  constructor() {
    const control = inject(AngularInlineDuration);
    this.resolvedCore = wireRole(
      this.rangeLength,
      control,
      (core) => core.attachLength(control),
      (group, leafBound) => group.attachLength(control, leafBound),
    );

    const di = inject(DateTimeRangeGroup, { optional: true });
    control.touch.subscribe(() => di?.touch.emit());
    control.saved.subscribe((session) => {
      if (session.changed) this.resolvedCore()?.lengthCommitted();
    });
  }
}
