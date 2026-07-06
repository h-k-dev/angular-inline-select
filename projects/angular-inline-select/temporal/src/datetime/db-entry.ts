/**
 * The DB-entry core — the sandbox mirror of iusta's `core/datetime`
 * (`toDBEntry(dt) = dt.toUTC().toISO()`), Luxon-free. It dictates the ONE
 * model format every temporal control speaks:
 *
 *   value / savedModelChange  =  UTC ISO datetime string ('…Z') | null
 *   display                   =  localized local-time strings
 *   duration                  =  seconds
 *
 * The difference between what the user sees and what is behind the back:
 * controls keep their local day/'HH:mm' machinery internally and convert
 * at the value boundary through these functions only.
 */

/** `'2026-07-20T19:00:00.000Z'` — `datetime.toUTC().toISO()`, SQL-friendly. */
export type DbDateTime = string;

/** Parses a DB entry (or any ISO 8601 the platform accepts) into a local `Date`. */
export function parseDbEntry(value: DbDateTime | null): Date | null {
  if (value === null || value === '') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The wire format: UTC ISO with `Z` — what iusta's `toDBEntry` produces. */
export function toDbEntry(date: Date): DbDateTime {
  return date.toISOString();
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The LOCAL calendar day of a DB entry: `'yyyy-MM-dd'`. */
export function localDayOf(value: DbDateTime | null): string | null {
  const date = parseDbEntry(value);
  if (date === null) return null;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The LOCAL wall-clock time of a DB entry: `'HH:mm'`. */
export function localTimeOf(value: DbDateTime | null): string | null {
  const date = parseDbEntry(value);
  if (date === null) return null;

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local midnight of a `'yyyy-MM-dd'` day, as a DB entry (`startOf('day')`). */
export function dayToDbEntry(day: string): DbDateTime {
  const [year, month, date] = day.split('-').map(Number);
  return toDbEntry(new Date(year, month - 1, date));
}

/** Local end-of-day of a `'yyyy-MM-dd'` day, as a DB entry (`endOf('day')`). */
export function dayEndToDbEntry(day: string): DbDateTime {
  const [year, month, date] = day.split('-').map(Number);
  return toDbEntry(new Date(year, month - 1, date, 23, 59, 59, 999));
}

/**
 * Rebuilds a DB entry from a local day + local wall-clock time — the
 * composition every commit runs (anchor day + typed time, or typed day +
 * preserved time).
 */
export function composeDbEntry(day: string, time: string): DbDateTime {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  return toDbEntry(new Date(year, month - 1, date, hours, minutes));
}

/** Shifts a DB entry by whole seconds (`shiftFromDuration`'s primitive). */
export function shiftDbEntry(value: DbDateTime, seconds: number): DbDateTime {
  const date = parseDbEntry(value);
  if (date === null) return value;

  return toDbEntry(new Date(date.getTime() + seconds * 1000));
}

/** Whole seconds between two DB entries (`induceFromTimeRange`'s primitive). */
export function diffDbEntrySeconds(start: DbDateTime, end: DbDateTime): number | null {
  const from = parseDbEntry(start);
  const to = parseDbEntry(end);
  if (from === null || to === null) return null;

  return Math.round((to.getTime() - from.getTime()) / 1000);
}

/**
 * LOCAL calendar days from `start`'s day to `end`'s day — the end field's
 * `+n` over-count, now intrinsic to the values.
 */
export function localDayDiff(start: DbDateTime, end: DbDateTime): number | null {
  const from = parseDbEntry(start);
  const to = parseDbEntry(end);
  if (from === null || to === null) return null;

  const dayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const dayEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  return Math.round((dayEnd.getTime() - dayStart.getTime()) / 86_400_000);
}

/** Moves `value` onto the local day of `day`, preserving its wall-clock time. */
export function moveDbEntryToDay(value: DbDateTime, day: string): DbDateTime {
  const time = localTimeOf(value);
  return time === null ? value : composeDbEntry(day, time);
}
