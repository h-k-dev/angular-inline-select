import { Directive, computed, inject, signal } from '@angular/core';

import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { toInternalRange, type IsoDate } from '../angular-inline-date/date-codec';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { INLINE_TIME_DAY_OFFSET } from '../angular-inline-time/day-offset';
import { AngularInlineDuration } from '../angular-inline-duration/angular-inline-duration';
import type { WallClockTime } from '../angular-inline-time/time-codec';

const DAY_SECONDS = 86_400;

function toSeconds(time: WallClockTime | null): number | null {
  if (time === null) return null;

  const [hours, minutes] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60;
}

function toWallClock(seconds: number): WallClockTime {
  const wrapped = ((seconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(Math.floor(wrapped / 3600))}:${pad(Math.floor((wrapped % 3600) / 60))}`;
}

/**
 * T5's group core: links SEPARATE temporal controls — a date (`rangeDay`),
 * two times (`rangeStart`/`rangeEnd`) and a duration (`rangeLength`) — via
 * DI, owning the invariants:
 *
 * - `duration = end − start` over the COMPOSED datetimes: committing a
 *   start or end recomputes the duration (an end at or before the start
 *   reads as next-day — wall-clock wrap); committing a duration MOVES the
 *   end. Day edits shift the whole stay and touch nothing else.
 * - The `+n` day-overflow badge on the end field (the airline arrival
 *   pattern) is DERIVED — duration-based when a duration participates,
 *   wall-clock wrap otherwise — and feeds the end control through the
 *   `INLINE_TIME_DAY_OFFSET` token. It never enters a draft or a value.
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

  /** The composed state, read live off the registered controls. */
  readonly day = computed<IsoDate | null>(() => {
    const control = this.#day();
    return control ? toInternalRange(control.value()).start : null;
  });
  readonly start = computed<WallClockTime | null>(() => this.#start()?.value() ?? null);
  readonly end = computed<WallClockTime | null>(() => this.#end()?.value() ?? null);
  readonly length = computed<number | null>(() => this.#length()?.value() ?? null);

  /**
   * Days the composed end overflows past the start's day — the end field's
   * `+n` badge. Duration-authoritative when a duration participates
   * (`21:00 + 30 h` = `+1` at `03:00`); wall-clock wrap otherwise (an end
   * at or before the start is next-day).
   */
  readonly endDayOffset = computed(() => {
    const start = toSeconds(this.start());
    if (start === null) return 0;

    const length = this.length();
    if (length !== null) return Math.floor((start + length) / DAY_SECONDS);

    const end = toSeconds(this.end());
    return end !== null && end <= start ? 1 : 0;
  });

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

  /**
   * A time endpoint settled: the duration follows (`duration = end − start`,
   * end-at-or-before-start wraps to next-day). A start commit with no end
   * but a duration fills the end instead.
   */
  timeCommitted() {
    const start = toSeconds(this.start());
    if (start === null) return;

    const end = toSeconds(this.end());
    if (end !== null) {
      const diff = end - start;
      this.#writeLength(diff <= 0 ? diff + DAY_SECONDS : diff);
      return;
    }

    const length = this.length();
    if (length !== null) this.#writeEnd(toWallClock(start + length));
  }

  /** A duration settled: the end MOVES (`end = start + duration`). */
  lengthCommitted() {
    const start = toSeconds(this.start());
    const length = this.length();
    if (start === null || length === null) return;

    this.#writeEnd(toWallClock(start + length));
  }

  /** Day edits shift the whole stay — wall-clock times and duration hold. */
  dayCommitted() {
    // Nothing to propagate in the single-day group; the maximal form
    // (separate end-day field) will shift the end day here.
  }

  #writeEnd(value: WallClockTime) {
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
      if (session.changed) group.timeCommitted();
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
      if (session.changed) group.timeCommitted();
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
