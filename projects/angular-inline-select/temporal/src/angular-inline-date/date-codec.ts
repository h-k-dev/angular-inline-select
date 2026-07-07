/**
 * Date codec — the canonical value is an ISO calendar date string
 * (`'2026-05-12' | null`): serializable, locale-free, timezone-free — the
 * date analogue of the phone control's E.164. Display and command names
 * localize through `Intl` at zero bundle bytes.
 */

import { DateTime } from 'luxon';

/** `'yyyy-MM-dd'`. */
export type IsoDate = string;

/** The object shapes of `InlineDateValue`: `{ start }` is the single-day range `[start, start]`. */
export interface IsoDateRange {
  start: IsoDate | null;
  end?: IsoDate | null;
}

/**
 * The polymorphic bound value. The consumer's binding shape IS the mode
 * declaration: a string binds a single date field, an object binds a range.
 * The control echoes the shape it received and never invents another one.
 */
export type InlineDateValue = IsoDate | IsoDateRange | null;

/** The shape a non-null value declares; `null` declares nothing (shape-ambiguous). */
export type DateValueShape = 'single' | 'start-only' | 'range';

export function inferDateShape(value: InlineDateValue): DateValueShape | null {
  if (value === null) return null;
  if (typeof value === 'string') return 'single';

  return 'end' in value ? 'range' : 'start-only';
}

/** One canonical internal model, always — whatever shape came in. */
export interface InternalDateRange {
  start: IsoDate | null;
  end: IsoDate | null;
}

export function toInternalRange(value: InlineDateValue): InternalDateRange {
  if (value === null) return { start: null, end: null };
  if (typeof value === 'string') return { start: value, end: value };

  const start = value.start ?? null;
  return { start, end: value.end === undefined ? start : value.end };
}

/**
 * The echo: renders the internal range back in the consumer's shape.
 * `start-only` keeps its one-key form until the data actually has a
 * distinct end — only then does it grow the `end` key.
 */
export function echoDateShape(
  internal: InternalDateRange,
  shape: DateValueShape,
): InlineDateValue {
  switch (shape) {
    case 'single':
      return internal.start;
    case 'start-only':
      return internal.end === internal.start || internal.end === null
        ? { start: internal.start }
        : { start: internal.start, end: internal.end };
    case 'range':
      return { start: internal.start, end: internal.end };
  }
}

/** Structural equality over the polymorphic value — echo writes must not loop. */
export function dateValuesEqual(a: InlineDateValue, b: InlineDateValue): boolean {
  if (a === null || b === null || typeof a === 'string' || typeof b === 'string') return a === b;

  return a.start === b.start && a.end === b.end;
}

export function toIsoDate(date: Date): IsoDate {
  return DateTime.fromJSDate(date).toFormat('yyyy-MM-dd');
}

function isoIfValid(year: number, month: number, day: number): IsoDate | undefined {
  const date = DateTime.fromObject({ year, month, day });
  return date.isValid ? date.toFormat('yyyy-MM-dd') : undefined;
}

// -----------------------------------------------------------------------------
// The round-trip typing law: `parse(format(value))` must equal `value` —
// whatever the display shows, the user can type back. Month and weekday
// names come from an `Intl` REVERSE lookup (locale + English, long +
// short forms) — zero bundled translations, the slash-menu lesson.
// -----------------------------------------------------------------------------

const normalizeToken = (token: string) => token.toLowerCase().replace(/[.,]+$/, '');

const nameTableCache = new Map<string, { months: Map<string, number>; weekdays: Set<string> }>();

function nameTable(locale: string | string[] | undefined) {
  const key = JSON.stringify(locale ?? '');
  const cached = nameTableCache.get(key);
  if (cached) return cached;

  const months = new Map<string, number>();
  const weekdays = new Set<string>();

  for (const tag of [locale, 'en'] as const) {
    for (const style of ['long', 'short'] as const) {
      try {
        const monthFormat = new Intl.DateTimeFormat(tag, { month: style });
        for (let month = 0; month < 12; month++) {
          const name = normalizeToken(monthFormat.format(new Date(2024, month, 1)));
          if (!months.has(name)) months.set(name, month + 1);
        }

        const weekdayFormat = new Intl.DateTimeFormat(tag, { weekday: style });
        for (let day = 1; day <= 7; day++) {
          weekdays.add(normalizeToken(weekdayFormat.format(new Date(2024, 0, day))));
        }
      } catch {
        // Unknown locale tag — the English pass still fills the table.
      }
    }
  }

  const table = { months, weekdays };
  nameTableCache.set(key, table);
  return table;
}

/** `'Dec 24, 2026'`, `'24. Dezember 2026'`, `'Thursday, December 24, 2026'` … */
function parseNamedDate(
  raw: string,
  now: Date,
  locale: string | string[] | undefined,
): IsoDate | undefined {
  const { months, weekdays } = nameTable(locale);

  const tokens = raw
    .split(/[\s,]+/)
    .map(normalizeToken)
    .filter((token) => token.length > 0 && !weekdays.has(token));

  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;

  for (const token of tokens) {
    if (months.has(token)) {
      if (month !== undefined) return undefined;
      month = months.get(token);
      continue;
    }

    if (!/^\d{1,4}$/.test(token)) return undefined;
    const value = Number(token);

    if (token.length === 4) {
      if (year !== undefined) return undefined;
      year = value;
    } else if (day === undefined) {
      day = value;
    } else if (year === undefined) {
      year = value < 100 ? 2000 + value : value;
    } else {
      return undefined;
    }
  }

  if (month === undefined || day === undefined) return undefined;
  return isoIfValid(year ?? now.getFullYear(), month, day);
}

/**
 * Parses a date draft into an ISO date. `''` → `null` (empty), text that is
 * not a calendar date → `undefined` (raises the parse gate).
 *
 * Accepted shapes: `'12.5.2026'`, `'12.5.26'` (→ 20xx), `'12.5.'` / `'12.5'`
 * (current year from `now`), `'2026-05-12'`, `'12/5/2026'` — and, per the
 * round-trip law, everything the display formats: `'Dec 24, 2026'`,
 * `'24. Dezember 2026'`, weekday prefixes stripped.
 */
export function parseDateInput(
  raw: string,
  now: Date = new Date(),
  locale?: string | string[],
): IsoDate | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // ISO: yyyy-M-d
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (match) return isoIfValid(Number(match[1]), Number(match[2]), Number(match[3]));

  // Dotted / slashed day-first: d.M.yyyy | d.M.yy | d.M. | d.M | d/M/yyyy
  match = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4})?)?$/.exec(trimmed);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year =
      match[3] === undefined
        ? now.getFullYear()
        : match[3].length === 2
          ? 2000 + Number(match[3])
          : Number(match[3]);

    return isoIfValid(year, month, day);
  }

  // Named months (the display's own format, localized + English).
  if (/[\p{L}]/u.test(trimmed)) return parseNamedDate(trimmed, now, locale);

  return undefined;
}

/** Localized display of an ISO date (`'12 May 2026'` / `'12. Mai 2026'`). */
export function formatIsoDate(
  iso: IsoDate | null,
  locale?: string | string[],
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  if (iso === null) return '';

  const [year, month, day] = iso.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date(year, month - 1, day));
  } catch {
    return iso;
  }
}

/** Long reading for the interpretation preview: `'Monday, 12 May 2026'`. */
export function describeIsoDate(iso: IsoDate, locale?: string | string[]): string {
  return formatIsoDate(iso, locale, { dateStyle: 'full' });
}

/**
 * Localized display of the internal range: single days render like
 * `formatIsoDate`; a distinct end renders through `formatRange`
 * (`'12 – 15 May 2026'`). Interim single-field display until T5's
 * two-field ranged UI.
 */
export function formatInternalRange(
  range: InternalDateRange,
  locale?: string | string[],
): string {
  const { start, end } = range;
  if (start === null && end === null) return '';
  if (start === null) return `– ${formatIsoDate(end, locale)}`;
  if (end === null || end === start) return formatIsoDate(start, locale);

  const toDate = (iso: IsoDate) => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).formatRange(
      toDate(start),
      toDate(end),
    );
  } catch {
    return `${start} – ${end}`;
  }
}

/** A slash-menu command resolving to a concrete date. */
export interface DateCommand {
  id: string;
  /** Localized label (`'morgen'`), from `Intl` — zero bundled translations. */
  label: string;
  /** Extra lower-cased matching basis (English + ISO), so `/tomorrow` works everywhere. */
  match: string;
  iso: IsoDate;
}

function relativeLabel(days: -1 | 0 | 1, locale?: string | string[]): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
  } catch {
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'yesterday';
  }
}

function weekdayLabel(date: Date, locale?: string | string[]): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  } catch {
    return date.toDateString().slice(0, 3);
  }
}

/**
 * The built-in slash commands: yesterday/today/tomorrow plus the next seven
 * weekdays. Labels localize to `locale` (browser default when omitted); the
 * matching basis always includes the English name and the ISO date.
 */
export function buildDateCommands(now: Date, locale?: string | string[]): DateCommand[] {
  const at = (offset: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    return date;
  };

  const english = (date: Date) =>
    new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date).toLowerCase();

  const relatives: DateCommand[] = ([-1, 0, 1] as const).map((offset) => {
    const date = at(offset);
    const label = relativeLabel(offset, locale);
    const englishName = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : 'yesterday';

    return {
      id: `ai-date-${englishName}`,
      label,
      match: `${label} ${englishName} ${toIsoDate(date)}`.toLowerCase(),
      iso: toIsoDate(date),
    };
  });

  const weekdays: DateCommand[] = Array.from({ length: 7 }, (_, index) => {
    const date = at(index + 1);
    const label = weekdayLabel(date, locale);

    return {
      id: `ai-date-weekday-${index}`,
      label,
      match: `${label} ${english(date)} ${toIsoDate(date)}`.toLowerCase(),
      iso: toIsoDate(date),
    };
  });

  return [...relatives, ...weekdays];
}
