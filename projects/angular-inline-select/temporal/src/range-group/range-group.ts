import { Directive, computed, effect, inject, output, signal } from '@angular/core';

import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { toInternalRange } from '../angular-inline-date/date-codec';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { INLINE_TIME_DAY_OFFSET } from '../angular-inline-time/day-offset';
import { AngularInlineDuration } from '../angular-inline-duration/angular-inline-duration';
import {
  addLocalDays,
  composeDbEntry,
  dayToDbEntry,
  dayEndToDbEntry,
  diffDbEntrySeconds,
  localDayDiff,
  localDayOf,
  localTimeOf,
  shiftDbEntry,
  type DbDateTime,
} from '../datetime/db-entry';

const DAY_SECONDS = 86_400;

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
  #start = signal<AngularInlineTime | null>(null);
  #end = signal<AngularInlineTime | null>(null);
  #length = signal<AngularInlineDuration | null>(null);

  /** The stay's LOCAL calendar day, read off the date control. */
  readonly day = computed<string | null>(() => {
    const control = this.#day();
    if (!control) return null;

    const start = toInternalRange(control.value()).start;
    return start === null ? null : localDayOf(start);
  });

  /** The endpoint instants and duration, read live off the controls. */
  readonly start = computed<DbDateTime | null>(() => this.#start()?.value() ?? null);
  readonly end = computed<DbDateTime | null>(() => this.#end()?.value() ?? null);
  readonly length = computed<number | null>(() => this.#length()?.value() ?? null);

  /**
   * The end field's `+n` badge: LOCAL calendar days between the two
   * instants — intrinsic to the values now that they carry their days.
   */
  readonly endDayOffset = computed(() => {
    const start = this.start();
    if (start === null) return 0;

    const end = this.end();
    if (end !== null) return Math.max(0, localDayDiff(start, end) ?? 0);

    const length = this.length();
    if (length !== null) return Math.max(0, localDayDiff(start, shiftDbEntry(start, length)) ?? 0);

    return 0;
  });

  /** The composed DATE value: day boundaries as DB entries, over-count applied. */
  readonly dateRange = computed<ComposedDateRange | null>(() => {
    const startDay = this.day() ?? (this.start() !== null ? localDayOf(this.start()) : null);
    if (startDay === null) return null;

    return {
      start: dayToDbEntry(startDay),
      end: dayEndToDbEntry(addLocalDays(startDay, this.endDayOffset())),
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
  }

  #emitChanges() {
    const date = this.dateRange();
    if (this.#lastDate === undefined || !sameRange(date, this.#lastDate)) {
      this.#lastDate = date;
      this.dateRangeChange.emit(date);
    }

    const time = this.timeRange();
    if (this.#lastTime === undefined || !sameRange(time, this.#lastTime)) {
      this.#lastTime = time;
      this.timeRangeChange.emit(time);
    }

    const length = this.length();
    if (this.#lastLength === undefined || length !== this.#lastLength) {
      this.#lastLength = length;
      this.durationChange.emit(length);
    }
  }

  // -- Registration (the role directives call these) --------------------------

  attachDay(control: AngularInlineDate) {
    this.#day.set(control);
  }
  attachStart(control: AngularInlineTime) {
    this.#start.set(control);
  }
  attachEnd(control: AngularInlineTime) {
    this.#end.set(control);
  }
  attachLength(control: AngularInlineDuration) {
    this.#length.set(control);
  }

  // -- Commit propagation ------------------------------------------------------

  /** Rolls `end` forward by whole days until it strictly follows `start`, then induces. */
  #induceFrom(start: DbDateTime, end: DbDateTime) {
    let diff = diffDbEntrySeconds(start, end)!;
    while (diff <= 0) {
      end = shiftDbEntry(end, DAY_SECONDS);
      diff += DAY_SECONDS;
    }

    this.#writeEnd(end);
    this.#writeLength(diff);
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
  endCommitted(dayOverflow = 0) {
    const start = this.start();
    const end = this.end();

    if (start !== null && end !== null) {
      const day = addLocalDays(localDayOf(start)!, dayOverflow);
      this.#induceFrom(start, composeDbEntry(day, localTimeOf(end)!));
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
      const offset = start !== null && end !== null ? Math.max(0, localDayDiff(start, end) ?? 0) : 0;

      if (start !== null) this.#writeStart(composeDbEntry(day, localTimeOf(start)!));
      if (end !== null) this.#writeEnd(composeDbEntry(addLocalDays(day, offset), localTimeOf(end)!));
    }

    this.#emitChanges();
  }

  #writeStart(value: DbDateTime) {
    const control = this.#start();
    if (control && control.value() !== value) control.value.set(value);
  }

  #writeEnd(value: DbDateTime) {
    const control = this.#end();
    if (control && control.value() !== value) control.value.set(value);
  }

  #writeLength(value: number) {
    const control = this.#length();
    if (control && control.value() !== value) control.value.set(value);
  }
}

/** Marks the group's date control: `<angular-inline-date rangeDay />`. */
@Directive({ selector: 'angular-inline-date[rangeDay]' })
export class RangeDay {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineDate);

    group.attachDay(control);
    control.saved.subscribe((session) => {
      if (session.changed) group.dayCommitted();
    });
  }
}

/** Marks the group's start time: `<angular-inline-time rangeStart />`. */
@Directive({ selector: 'angular-inline-time[rangeStart]' })
export class RangeStart {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineTime);

    group.attachStart(control);
    control.saved.subscribe((session) => {
      if (session.changed) group.startCommitted();
    });
  }
}

/**
 * Marks the group's end time: `<angular-inline-time rangeEnd />`. Also
 * feeds the control's `+n` day-overflow badge via `INLINE_TIME_DAY_OFFSET`.
 */
@Directive({
  selector: 'angular-inline-time[rangeEnd]',
  providers: [
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

    group.attachEnd(control);
    control.saved.subscribe((session) => {
      if (session.changed) group.endCommitted(session.dayOverflow);
    });
  }
}

/** Marks the group's duration: `<angular-inline-duration rangeLength />`. */
@Directive({ selector: 'angular-inline-duration[rangeLength]' })
export class RangeLength {
  constructor() {
    const group = inject(DateTimeRangeGroup);
    const control = inject(AngularInlineDuration);

    group.attachLength(control);
    control.saved.subscribe((session) => {
      if (session.changed) group.lengthCommitted();
    });
  }
}
