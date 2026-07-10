import { DateTime } from 'luxon';

/**
 * The DB-entry core — the sandbox mirror of iusta's `core/datetime`
 * (`toDBEntry(dt) = dt.toUTC().toISO()`), built ON LUXON (decided: iusta's
 * datetime house engine is Luxon end to end, and T6's server-side timezone
 * story needs a real tz engine). It dictates the ONE model format every
 * temporal control speaks:
 *
 *   value / savedModelChange  =  UTC ISO datetime string ('…Z') | null
 *   display                   =  localized wall-clock strings, in the
 *                                DISPLAY ZONE
 *   duration                  =  seconds
 *
 * T6 — THE ZONE IS CONFIGURATION, THE VALUE IS NOT: every "local" helper
 * takes an optional trailing IANA `zone`. Omitted, the machine zone reads
 * (the pre-T6 behavior, byte-identical); given, days and wall-clocks are
 * that zone's (iusta's `ServerSideDatetimeConfiguration` analogue — see
 * `INLINE_TEMPORAL_ZONE`). Instant math (shift/diff) is zone-free.
 *
 * Luxon itself is CONTAINED here (and consumed via the
 * `toDateTime`/`toDBEntry` bridge) — values stay plain strings, and the
 * engine ships only with the temporal entry point, exactly like
 * libphonenumber ships only with `/phone`.
 */

/** `'2026-07-20T19:00:00.000Z'` — `datetime.toUTC().toISO()`, SQL-friendly. */
export type DbDateTime = string;

/** An IANA zone id (`'Europe/Berlin'`); `undefined` = the machine zone. */
export type ZoneId = string | undefined;

/** The Luxon bridge, inbound: a DB entry (or any ISO 8601) in the display zone. */
export function toDateTime(value: DbDateTime | null, zone?: ZoneId): DateTime | null {
  if (value === null || value === '') return null;

  const parsed = zone ? DateTime.fromISO(value, { zone }) : DateTime.fromISO(value);
  return parsed.isValid ? parsed : null;
}

/** The Luxon bridge, outbound — THE house function (iusta naming wins for utils). */
export function toDBEntry(dateTime: DateTime): DbDateTime {
  return dateTime.toUTC().toISO()!;
}

/** Parses a DB entry into a local `Date` (consumer convenience). */
export function parseDbEntry(value: DbDateTime | null): Date | null {
  return toDateTime(value)?.toJSDate() ?? null;
}

/** The wire format from a JS `Date` — `toDBEntry(DateTime.fromJSDate(date))`. */
export function dateToDbEntry(date: Date): DbDateTime {
  return toDBEntry(DateTime.fromJSDate(date));
}

/**
 * A FULL ISO datetime typed/pasted as a draft (`'2026-07-21T21:00'`,
 * `'2026-07-21 21:00'`, with or without seconds/zone) — the decomposition
 * trigger. A string WITHOUT an offset reads in the display zone. Anything
 * else (including bare dates and bare times) is `undefined`: those belong
 * to the field codecs.
 */
export function parseDbEntryDraft(raw: string, zone?: ZoneId): DbDateTime | undefined {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) return undefined;

  const iso = trimmed.replace(' ', 'T');
  const parsed = zone ? DateTime.fromISO(iso, { zone }) : DateTime.fromISO(iso);
  return parsed.isValid ? toDBEntry(parsed) : undefined;
}

/** The display-zone calendar day of a DB entry: `'yyyy-MM-dd'`. */
export function localDayOf(value: DbDateTime | null, zone?: ZoneId): string | null {
  return toDateTime(value, zone)?.toFormat('yyyy-MM-dd') ?? null;
}

/** The display-zone wall-clock time of a DB entry: `'HH:mm'`. */
export function localTimeOf(value: DbDateTime | null, zone?: ZoneId): string | null {
  return toDateTime(value, zone)?.toFormat('HH:mm') ?? null;
}

function dayIn(day: string, zone?: ZoneId): DateTime {
  return zone ? DateTime.fromISO(day, { zone }) : DateTime.fromISO(day);
}

/** Display-zone midnight of a `'yyyy-MM-dd'` day, as a DB entry (`startOf('day')`). */
export function dayToDbEntry(day: string, zone?: ZoneId): DbDateTime {
  return toDBEntry(dayIn(day, zone).startOf('day'));
}

/** Display-zone end-of-day of a `'yyyy-MM-dd'` day, as a DB entry (`endOf('day')`). */
export function dayEndToDbEntry(day: string, zone?: ZoneId): DbDateTime {
  return toDBEntry(dayIn(day, zone).endOf('day'));
}

/**
 * Rebuilds a DB entry from a display-zone day + wall-clock time — the
 * composition every commit runs (anchor day + typed time, or typed day +
 * preserved time).
 */
export function composeDbEntry(day: string, time: string, zone?: ZoneId): DbDateTime {
  // `'HH:mm:ss'` composes with its seconds (iusta's HOUR_MINUTE_SECOND
  // format); bare `'HH:mm'` stays second-less.
  const [hour, minute, second = 0] = time.split(':').map(Number);
  return toDBEntry(dayIn(day, zone).set({ hour, minute, second, millisecond: 0 }));
}

/** Shifts a DB entry by whole seconds (`shiftFromDuration`'s primitive) — zone-free. */
export function shiftDbEntry(value: DbDateTime, seconds: number): DbDateTime {
  const dateTime = toDateTime(value);
  return dateTime === null ? value : toDBEntry(dateTime.plus({ seconds }));
}

/** Whole seconds between two DB entries (`induceFromTimeRange`'s primitive) — zone-free. */
export function diffDbEntrySeconds(start: DbDateTime, end: DbDateTime): number | null {
  const from = toDateTime(start);
  const to = toDateTime(end);
  if (from === null || to === null) return null;

  return Math.round(to.diff(from, 'seconds').seconds);
}

/**
 * Rolls `end` forward by whole LOCAL days until it strictly follows `start` —
 * the range house rule, shared by the ranged time control and the range
 * group (a typed end is WALL-CLOCK intent: at-or-before the start it means a
 * later day — `23:30` the same evening, `06:00` overnight). Calendar-day
 * math in the display zone, so the end's wall-clock reading survives DST
 * transitions (a fixed 86 400 s shift would drift it an hour). Unreadable
 * inputs return `end` unchanged.
 */
export function rollDbEntryForward(start: DbDateTime, end: DbDateTime, zone?: ZoneId): DbDateTime {
  const from = toDateTime(start, zone);
  let to = toDateTime(end, zone);
  if (from === null || to === null || to > from) return end;

  // Jump the local-day gap in ONE calendar shift, then nudge over the rare
  // DST-length wobble — never a per-day walk.
  const dayGap = Math.round(from.startOf('day').diff(to.startOf('day'), 'days').days);
  if (dayGap > 0) to = to.plus({ days: dayGap });
  while (to <= from) to = to.plus({ days: 1 });

  return toDBEntry(to);
}

/**
 * Display-zone calendar days from `start`'s day to `end`'s day — the end
 * field's `+n` over-count, now intrinsic to the values.
 */
export function localDayDiff(start: DbDateTime, end: DbDateTime, zone?: ZoneId): number | null {
  const from = toDateTime(start, zone);
  const to = toDateTime(end, zone);
  if (from === null || to === null) return null;

  return Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days);
}

/** Moves `value` onto the display-zone day of `day`, preserving its wall-clock time. */
export function moveDbEntryToDay(value: DbDateTime, day: string, zone?: ZoneId): DbDateTime {
  const time = localTimeOf(value, zone);
  return time === null ? value : composeDbEntry(day, time, zone);
}

/** Shifts a `'yyyy-MM-dd'` day by whole calendar days — plain day-string math, zone-free. */
export function addLocalDays(day: string, days: number): string {
  return DateTime.fromISO(day).plus({ days }).toFormat('yyyy-MM-dd');
}

/** Today's calendar day in the display zone, from a reference clock. */
export function todayIn(now: Date, zone?: ZoneId): string {
  const dateTime = zone ? DateTime.fromJSDate(now, { zone }) : DateTime.fromJSDate(now);
  return dateTime.toFormat('yyyy-MM-dd');
}
