/**
 * Time codec — the canonical value is a 24 h wall-clock string
 * (`'HH:mm' | null`): locale/timezone-free, the time analogue of the date
 * control's ISO string. Display localizes through `Intl`.
 *
 * The `InlineTimeValue` shapes below speak DB entries (full instants) —
 * they are the control's VALUE boundary, the time mirror of the date
 * codec's `InlineDateValue` machinery.
 */

import type { DbDateTime } from '../datetime/db-entry';

/** `'HH:mm'`. */
export type WallClockTime = string;

/** The object shapes of `InlineTimeValue`: a missing `end` key is a HALF-OPEN range. */
export interface DbTimeRange {
  start: DbDateTime | null;
  end?: DbDateTime | null;
}

/**
 * The polymorphic bound value. The consumer's binding shape IS the mode
 * declaration: a string binds a single time field, an object binds the
 * start–end pair. The control echoes the shape it received and never
 * invents another one.
 */
export type InlineTimeValue = DbDateTime | DbTimeRange | null;

/** The shape a non-null value declares; `null` declares nothing (shape-ambiguous). */
export type TimeValueShape = 'single' | 'start-only' | 'range';

export function inferTimeShape(value: InlineTimeValue): TimeValueShape | null {
  if (value === null) return null;
  if (typeof value === 'string') return 'single';

  return 'end' in value ? 'range' : 'start-only';
}

/** One canonical internal model, always — whatever shape came in. */
export interface InternalTimeRange {
  start: DbDateTime | null;
  end: DbDateTime | null;
}

/**
 * Unlike a single DATE (the day-range `[start, start]`), a single time is
 * one instant and a zero-length range is meaningless — so `{ start }` is a
 * HALF-OPEN range (`end: null`), never a mirror.
 */
export function toInternalTimeRange(value: InlineTimeValue): InternalTimeRange {
  if (value === null) return { start: null, end: null };
  if (typeof value === 'string') return { start: value, end: null };

  return { start: value.start ?? null, end: value.end ?? null };
}

/**
 * The echo: renders the internal range back in the consumer's shape.
 * `start-only` keeps its one-key form until the data actually has an end —
 * only then does it grow the `end` key.
 */
export function echoTimeShape(internal: InternalTimeRange, shape: TimeValueShape): InlineTimeValue {
  switch (shape) {
    case 'single':
      return internal.start;
    case 'start-only':
      return internal.end === null
        ? { start: internal.start }
        : { start: internal.start, end: internal.end };
    case 'range':
      return { start: internal.start, end: internal.end };
  }
}

/** Structural equality over the polymorphic value — echo writes must not loop. */
export function timeValuesEqual(a: InlineTimeValue, b: InlineTimeValue): boolean {
  if (a === null || b === null || typeof a === 'string' || typeof b === 'string') return a === b;

  return a.start === b.start && a.end === b.end;
}

const pad = (value: number) => String(value).padStart(2, '0');

function timeIfValid(hours: number, minutes: number): WallClockTime | undefined {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * A parsed time draft: the wall-clock time plus the DAY OVERFLOW typed as
 * hours beyond 23 — `'24:30'` → `{ time: '00:30', days: 1 }`, `'240:30'` →
 * `{ time: '00:30', days: 10 }`. Plain times carry `days: 0`.
 */
export interface TimeDraft {
  time: WallClockTime;
  days: number;
}

function draftIfValid(hours: number, minutes: number): TimeDraft | undefined {
  if (hours < 0 || minutes < 0 || minutes > 59) return undefined;

  const time = timeIfValid(hours % 24, minutes);
  return time === undefined ? undefined : { time, days: Math.floor(hours / 24) };
}

// The round-trip typing law: the display's day-period markers must parse
// back. The locale's own strings come from `Intl.formatToParts`; the
// universal am/pm spellings are always accepted.
const dayPeriodCache = new Map<string, { am: Set<string>; pm: Set<string> }>();

function dayPeriods(locale: string | string[] | undefined) {
  const key = JSON.stringify(locale ?? '');
  const cached = dayPeriodCache.get(key);
  if (cached) return cached;

  const am = new Set(['am', 'a.m.']);
  const pm = new Set(['pm', 'p.m.']);
  try {
    const format = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true });
    const period = (hour: number) =>
      format
        .formatToParts(new Date(2024, 0, 1, hour))
        .find((part) => part.type === 'dayPeriod')
        ?.value.toLowerCase();

    const localAm = period(9);
    const localPm = period(21);
    if (localAm) am.add(localAm);
    if (localPm) pm.add(localPm);
  } catch {
    // Universal spellings remain.
  }

  const table = { am, pm };
  dayPeriodCache.set(key, table);
  return table;
}

/**
 * Parses a time draft into `{ time, days }`. `''` → `null`, non-times →
 * `undefined` (raises the parse gate).
 *
 * Accepted shapes: `'9'` → 09:00, `'21'` → 21:00, `'930'`/`'0930'` → 09:30,
 * `'2105'` → 21:05, `'9:30'`, `'09.30'` — an optional `:ss` tail
 * (`'21:30:15'`, meridiem-free — the seconds format's own display parses
 * back) — OVERFLOW hours declaring the day over-count by hand
 * (`'24:30'`/`'2430'` → next day 00:30, `'240:30'` → +10 days 00:30; bare
 * 1–2 digit hours stay strict, `'99'` is a typo) — and, per the round-trip
 * law, the display's own day-period formats: `'9:30 AM'`, `'12:00 AM'` →
 * 00:00, `'9 PM'` → 21:00.
 */
export function parseTimeDraft(
  raw: string,
  locale?: string | string[],
): TimeDraft | null | undefined {
  let trimmed = raw.trim();
  if (trimmed === '') return null;

  // Trailing day-period marker (the display's 12 h formats).
  let meridiem: 'am' | 'pm' | undefined;
  const periodMatch = /^(.*?)\s*(\S+\.?)$/.exec(trimmed);
  if (periodMatch && /[\p{L}.]/u.test(periodMatch[2])) {
    const token = periodMatch[2].toLowerCase();
    const { am, pm } = dayPeriods(locale);
    if (am.has(token)) meridiem = 'am';
    else if (pm.has(token)) meridiem = 'pm';

    if (meridiem !== undefined) trimmed = periodMatch[1].trim();
  }

  const applyMeridiem = (draft: TimeDraft | undefined): TimeDraft | undefined => {
    if (draft === undefined || meridiem === undefined) return draft;
    if (draft.days > 0) return undefined; // overflow + AM/PM is nonsense

    const [hours] = draft.time.split(':').map(Number);
    if (hours > 12 || hours === 0) return undefined;

    const shifted = meridiem === 'pm' ? (hours % 12) + 12 : hours % 12;
    return { time: `${String(shifted).padStart(2, '0')}:${draft.time.slice(-2)}`, days: 0 };
  };

  // Separated: H:mm / H.mm — hours may overflow into days (up to 3 digits) —
  // plus an optional `:ss` tail (the seconds format's own display must parse
  // back) — carried in the time string, meridiem-free.
  const match = /^(\d{1,3})[:.](\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (match) {
    const draft = applyMeridiem(draftIfValid(Number(match[1]), Number(match[2])));
    if (draft === undefined || match[3] === undefined) return draft;
    if (meridiem !== undefined || Number(match[3]) > 59) return undefined;

    return { time: `${draft.time}:${match[3]}`, days: draft.days };
  }

  // Compact digits: H / HH / Hmm / HHmm
  if (/^\d{1,4}$/.test(trimmed)) {
    if (trimmed.length <= 2) {
      const time = timeIfValid(Number(trimmed), 0);
      return applyMeridiem(time === undefined ? undefined : { time, days: 0 });
    }

    return applyMeridiem(draftIfValid(Number(trimmed.slice(0, -2)), Number(trimmed.slice(-2))));
  }

  return undefined;
}

/**
 * Overflow-free convenience over `parseTimeDraft`: plain `'HH:mm'` or the
 * parse gate — overflow drafts are UNDEFINED here (callers that can't
 * carry the day over-count must reject them).
 */
export function parseTime(
  raw: string,
  locale?: string | string[],
): WallClockTime | null | undefined {
  const draft = parseTimeDraft(raw, locale);
  if (draft === null || draft === undefined) return draft;

  return draft.days === 0 ? draft.time : undefined;
}

// Formatter construction is the expensive part of Intl — cache per locale
// (the dayPeriodCache pattern): the display computeds re-run per keystroke.
const wallClockFormatCache = new Map<string, Intl.DateTimeFormat>();

function wallClockFormat(locale?: string | string[]): Intl.DateTimeFormat {
  const key = JSON.stringify(locale ?? '');
  const cached = wallClockFormatCache.get(key);
  if (cached) return cached;

  const format = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
  wallClockFormatCache.set(key, format);
  return format;
}

/** Localized display (`'9:30 AM'` under `en`, `'09:30'` under `de`). */
export function formatWallClock(time: WallClockTime | null, locale?: string | string[]): string {
  if (time === null) return '';

  const [hours, minutes] = time.split(':').map(Number);
  try {
    return wallClockFormat(locale).format(new Date(2000, 0, 1, hours, minutes));
  } catch {
    return time;
  }
}
