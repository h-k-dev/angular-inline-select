/**
 * Date codec — the canonical value is an ISO calendar date string
 * (`'2026-05-12' | null`): serializable, locale-free, timezone-free — the
 * date analogue of the phone control's E.164. Display and command names
 * localize through `Intl` at zero bundle bytes.
 */

/** `'yyyy-MM-dd'`. */
export type IsoDate = string;

const pad = (value: number) => String(value).padStart(2, '0');

export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoIfValid(year: number, month: number, day: number): IsoDate | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const date = new Date(year, month - 1, day);
  const roundTrips =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  return roundTrips ? toIsoDate(date) : undefined;
}

/**
 * Parses a date draft into an ISO date. `''` → `null` (empty), text that is
 * not a calendar date → `undefined` (raises the parse gate).
 *
 * Accepted shapes: `'12.5.2026'`, `'12.5.26'` (→ 20xx), `'12.5.'` / `'12.5'`
 * (current year from `now`), `'2026-05-12'`, `'12/5/2026'`.
 */
export function parseDateInput(raw: string, now: Date = new Date()): IsoDate | null | undefined {
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
