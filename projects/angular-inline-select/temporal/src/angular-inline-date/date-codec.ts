/**
 * Date codec — the canonical value is an ISO calendar date string
 * (`'2026-05-12' | null`): serializable, locale-free, timezone-free — the
 * date analogue of the phone control's E.164. Display and command names
 * localize through `Intl` at zero bundle bytes.
 */

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
