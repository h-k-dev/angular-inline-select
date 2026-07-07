import { DateTime } from 'luxon';

/**
 * The DB-entry core — the sandbox mirror of iusta's `core/datetime`
 * (`toDBEntry(dt) = dt.toUTC().toISO()`), built ON LUXON (decided: iusta's
 * datetime house engine is Luxon end to end, and T6's server-side timezone
 * story needs a real tz engine). It dictates the ONE model format every
 * temporal control speaks:
 *
 *   value / savedModelChange  =  UTC ISO datetime string ('…Z') | null
 *   display                   =  localized local-time strings
 *   duration                  =  seconds
 *
 * The difference between what the user sees and what is behind the back:
 * controls keep their local day/'HH:mm' machinery internally and convert
 * at the value boundary through these functions only. Luxon itself is
 * CONTAINED here (and consumed via the `toDateTime`/`fromDateTime`
 * bridge) — values stay plain strings, and the engine ships only with the
 * temporal entry point, exactly like libphonenumber ships only with
 * `/phone`.
 */

/** `'2026-07-20T19:00:00.000Z'` — `datetime.toUTC().toISO()`, SQL-friendly. */
export type DbDateTime = string;

/** The Luxon bridge, inbound: a DB entry (or any ISO 8601) as a local-zone `DateTime`. */
export function toDateTime(value: DbDateTime | null): DateTime | null {
  if (value === null || value === '') return null;

  const parsed = DateTime.fromISO(value);
  return parsed.isValid ? parsed : null;
}

/** The Luxon bridge, outbound: iusta's `toDBEntry`, verbatim. */
export function fromDateTime(dateTime: DateTime): DbDateTime {
  return dateTime.toUTC().toISO()!;
}

/** Parses a DB entry into a local `Date` (consumer convenience). */
export function parseDbEntry(value: DbDateTime | null): Date | null {
  return toDateTime(value)?.toJSDate() ?? null;
}

/** The wire format from a JS `Date` — `toDBEntry(DateTime.fromJSDate(date))`. */
export function toDbEntry(date: Date): DbDateTime {
  return fromDateTime(DateTime.fromJSDate(date));
}

/** The LOCAL calendar day of a DB entry: `'yyyy-MM-dd'`. */
export function localDayOf(value: DbDateTime | null): string | null {
  return toDateTime(value)?.toFormat('yyyy-MM-dd') ?? null;
}

/** The LOCAL wall-clock time of a DB entry: `'HH:mm'`. */
export function localTimeOf(value: DbDateTime | null): string | null {
  return toDateTime(value)?.toFormat('HH:mm') ?? null;
}

/** Local midnight of a `'yyyy-MM-dd'` day, as a DB entry (`startOf('day')`). */
export function dayToDbEntry(day: string): DbDateTime {
  return fromDateTime(DateTime.fromISO(day).startOf('day'));
}

/** Local end-of-day of a `'yyyy-MM-dd'` day, as a DB entry (`endOf('day')`). */
export function dayEndToDbEntry(day: string): DbDateTime {
  return fromDateTime(DateTime.fromISO(day).endOf('day'));
}

/**
 * Rebuilds a DB entry from a local day + local wall-clock time — the
 * composition every commit runs (anchor day + typed time, or typed day +
 * preserved time).
 */
export function composeDbEntry(day: string, time: string): DbDateTime {
  const [hour, minute] = time.split(':').map(Number);
  return fromDateTime(DateTime.fromISO(day).set({ hour, minute, second: 0, millisecond: 0 }));
}

/** Shifts a DB entry by whole seconds (`shiftFromDuration`'s primitive). */
export function shiftDbEntry(value: DbDateTime, seconds: number): DbDateTime {
  const dateTime = toDateTime(value);
  return dateTime === null ? value : fromDateTime(dateTime.plus({ seconds }));
}

/** Whole seconds between two DB entries (`induceFromTimeRange`'s primitive). */
export function diffDbEntrySeconds(start: DbDateTime, end: DbDateTime): number | null {
  const from = toDateTime(start);
  const to = toDateTime(end);
  if (from === null || to === null) return null;

  return Math.round(to.diff(from, 'seconds').seconds);
}

/**
 * LOCAL calendar days from `start`'s day to `end`'s day — the end field's
 * `+n` over-count, now intrinsic to the values.
 */
export function localDayDiff(start: DbDateTime, end: DbDateTime): number | null {
  const from = toDateTime(start);
  const to = toDateTime(end);
  if (from === null || to === null) return null;

  return Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days);
}

/** Moves `value` onto the local day of `day`, preserving its wall-clock time. */
export function moveDbEntryToDay(value: DbDateTime, day: string): DbDateTime {
  const time = localTimeOf(value);
  return time === null ? value : composeDbEntry(day, time);
}

/** Shifts a `'yyyy-MM-dd'` LOCAL day by whole calendar days. */
export function addLocalDays(day: string, days: number): string {
  return DateTime.fromISO(day).plus({ days }).toFormat('yyyy-MM-dd');
}
