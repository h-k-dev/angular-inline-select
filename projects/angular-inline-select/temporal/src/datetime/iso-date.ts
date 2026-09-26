import { DateTime } from 'luxon';

/**
 * A CALENDAR DATE — `'2026-05-12'`: no time of day, no zone (the
 * `Temporal.PlainDate` of the house). THE value every date-only field
 * speaks (a due date, a birthday, a holiday); instants are `DbDateTime`s
 * and never double as dates. Conversions to a storage format live at the
 * storage boundary, never in a control.
 *
 * All arithmetic here is calendar arithmetic in UTC — a day is a day,
 * whatever zone the machine runs in and whatever DST does.
 */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(day: IsoDate): DateTime {
  return DateTime.fromISO(day, { zone: 'utc' });
}

/** Whether `value` is a real calendar date spelled `'yyyy-MM-dd'` (`'2026-02-30'` is not). */
export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && ISO_DATE.test(value) && utcDay(value).isValid;
}

/** Shifts a calendar date by whole days. */
export function addDays(day: IsoDate, days: number): IsoDate {
  return utcDay(day).plus({ days }).toISODate()!;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(day: IsoDate): number {
  return utcDay(day).weekday;
}

/** Saturday or Sunday — the weekend of §193 BGB / §222 ZPO, independent of any locale's week data. */
export function isWeekend(day: IsoDate): boolean {
  return weekdayOf(day) >= 6;
}

/** `< 0` when `a` is earlier, `0` when equal, `> 0` when later (ISO dates sort as strings). */
export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The calendar date an instant falls on in `zone` (the machine zone when omitted). */
export function isoDateOfInstant(instant: DateTime | Date, zone?: string): IsoDate {
  const dateTime = instant instanceof Date ? DateTime.fromJSDate(instant) : instant;
  return (zone ? dateTime.setZone(zone) : dateTime).toISODate()!;
}
