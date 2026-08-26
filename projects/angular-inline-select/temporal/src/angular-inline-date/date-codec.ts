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

/**
 * The `savedModelChange` payload — the date MODEL (iusta's house shape,
 * sides widened to nullable: the change-gated cadence reports EVERY model
 * change, so half-open and cleared states carry `null` sides). Single mode
 * always carries `end: null`. The value channel stays plain strings — this
 * event is the Luxon rendering.
 */
export interface DateSavedDetails {
  start: DateTime | null;
  end: DateTime | null;
}

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
  nowYear: number,
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
  return isoIfValid(year ?? nowYear, month, day);
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
  zone?: string,
): IsoDate | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // A FULL ISO datetime (pasted) decomposes: the DISPLAY-ZONE day of the instant.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) {
    const iso = trimmed.replace(' ', 'T');
    const instant = zone ? DateTime.fromISO(iso, { zone }) : DateTime.fromISO(iso);
    return instant.isValid ? instant.toFormat('yyyy-MM-dd') : undefined;
  }

  // Year-less shapes complete from `now` — read in the display zone.
  const nowYear = zone ? DateTime.fromJSDate(now, { zone }).year : now.getFullYear();

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
        ? nowYear
        : match[3].length === 2
          ? 2000 + Number(match[3])
          : Number(match[3]);

    return isoIfValid(year, month, day);
  }

  // Named months (the display's own format, localized + English).
  if (/[\p{L}]/u.test(trimmed)) return parseNamedDate(trimmed, nowYear, locale);

  return undefined;
}

const placeholderCache = new Map<string, string>();

/**
 * The letters ONE locale spells the date fields with in a typing hint —
 * `{ day: 't', month: 'm', year: 'j' }` renders German's `tt.mm.jjjj`.
 * Lower-cased by convention here (the control's placeholders are quiet);
 * an override may return any casing.
 */
export interface DatePlaceholderTokens {
  day: string;
  month: string;
  year: string;
}

/**
 * The one thing `Intl` cannot tell us. `formatToParts` gives the field
 * ORDER and the separators for every locale on earth, but the letters a
 * reader expects in a typing hint are words in their language — `Tag`,
 * `jour`, `giorno`, `день` — and no `Intl` surface exposes them. So: a
 * table, kept to the primary language subtag, listing what native date
 * inputs show in that locale. Unlisted languages fall back to `d/m/y`,
 * which is also correct for every English variant — and is where a
 * language whose own words would COLLIDE belongs (Lithuanian's mėnuo and
 * metai are both `m`; `mmmm-mm-dd` hints less than `yyyy-mm-dd`).
 */
const PLACEHOLDER_TOKENS: Record<string, DatePlaceholderTokens> = {
  bg: { day: 'д', month: 'м', year: 'г' }, // ден / месец / година
  bs: { day: 'd', month: 'm', year: 'g' }, // dan / mjesec / godina
  ca: { day: 'd', month: 'm', year: 'a' }, // dia / mes / any
  cs: { day: 'd', month: 'm', year: 'r' }, // den / měsíc / rok
  da: { day: 'd', month: 'm', year: 'å' }, // dag / måned / år
  de: { day: 't', month: 'm', year: 'j' }, // Tag / Monat / Jahr
  el: { day: 'η', month: 'μ', year: 'ε' }, // ημέρα / μήνας / έτος
  es: { day: 'd', month: 'm', year: 'a' }, // día / mes / año
  et: { day: 'p', month: 'k', year: 'a' }, // päev / kuu / aasta
  fi: { day: 'p', month: 'k', year: 'v' }, // päivä / kuukausi / vuosi
  fr: { day: 'j', month: 'm', year: 'a' }, // jour / mois / année
  hr: { day: 'd', month: 'm', year: 'g' }, // dan / mjesec / godina
  hu: { day: 'n', month: 'h', year: 'é' }, // nap / hónap / év
  it: { day: 'g', month: 'm', year: 'a' }, // giorno / mese / anno
  lv: { day: 'd', month: 'm', year: 'g' }, // diena / mēnesis / gads
  nb: { day: 'd', month: 'm', year: 'å' }, // dag / måned / år
  nl: { day: 'd', month: 'm', year: 'j' }, // dag / maand / jaar
  nn: { day: 'd', month: 'm', year: 'å' },
  no: { day: 'd', month: 'm', year: 'å' },
  pl: { day: 'd', month: 'm', year: 'r' }, // dzień / miesiąc / rok
  pt: { day: 'd', month: 'm', year: 'a' }, // dia / mês / ano
  ro: { day: 'z', month: 'l', year: 'a' }, // zi / lună / an
  ru: { day: 'д', month: 'м', year: 'г' }, // день / месяц / год
  sk: { day: 'd', month: 'm', year: 'r' }, // deň / mesiac / rok
  sl: { day: 'd', month: 'm', year: 'l' }, // dan / mesec / leto
  sr: { day: 'd', month: 'm', year: 'g' }, // dan / mesec / godina
  sv: { day: 'd', month: 'm', year: 'å' }, // dag / månad / år
  tr: { day: 'g', month: 'a', year: 'y' }, // gün / ay / yıl
  uk: { day: 'д', month: 'м', year: 'р' }, // день / місяць / рік
};

const DEFAULT_PLACEHOLDER_TOKENS: DatePlaceholderTokens = { day: 'd', month: 'm', year: 'y' };

/**
 * The placeholder letters for a locale: the first tag in the list whose
 * primary language subtag the table knows, else `d/m/y`. The resolution
 * mirrors `Intl`'s own list handling — a `['de-AT', 'en']` binding takes
 * German, because that is the locale `formatToParts` will have used for
 * the surrounding order and separators.
 */
export function datePlaceholderTokens(locale?: string | string[]): DatePlaceholderTokens {
  if (locale === undefined) {
    // Browser default — whatever `Intl` will resolve the pattern with.
    try {
      locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      return DEFAULT_PLACEHOLDER_TOKENS;
    }
  }

  for (const tag of Array.isArray(locale) ? locale : [locale]) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    const tokens = PLACEHOLDER_TOKENS[language];
    if (tokens) return tokens;
  }

  return DEFAULT_PLACEHOLDER_TOKENS;
}

/**
 * The locale's NUMERIC date pattern as a fixed-size typing hint:
 * `'tt.mm.jjjj'` for German, `'mm/dd/yyyy'` for en-US, `'yyyy. mm. dd.'`
 * for Korean — order and separators from `Intl.formatToParts`, the field
 * letters from `tokens` (the locale's own, per `datePlaceholderTokens`).
 * Four-digit year on purpose: it is what a commit displays back (the
 * parser reads 2-digit years as 20xx regardless). Used as the control's
 * default placeholder, which also floors the field width — same locale,
 * same size, every render.
 */
export function localeDatePlaceholder(
  locale?: string | string[],
  tokens: DatePlaceholderTokens = datePlaceholderTokens(locale),
): string {
  const key = JSON.stringify([locale ?? '', tokens.day, tokens.month, tokens.year]);
  const cached = placeholderCache.get(key);
  if (cached !== undefined) return cached;

  const day = tokens.day.repeat(2);
  const month = tokens.month.repeat(2);
  const year = tokens.year.repeat(4);

  // The reference day needs 2-digit day AND month — else a locale that
  // ignores the '2-digit' request would produce a lying width floor.
  let pattern = `${year}-${month}-${day}`;
  try {
    pattern = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
      .formatToParts(new Date(2024, 11, 31))
      .map((part) => {
        switch (part.type) {
          case 'day':
            return day;
          case 'month':
            return month;
          case 'year':
            return year;
          case 'literal':
            return part.value;
          default:
            return ''; // era etc. — not typing hints
        }
      })
      .join('');
  } catch {
    // Unknown locale tag — the ISO fallback stands.
  }

  placeholderCache.set(key, pattern);
  return pattern;
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
 * The built-in quick-pick commands: yesterday/today/tomorrow plus the next
 * seven weekdays. Labels localize to `locale` (browser default when
 * omitted); the matching basis always includes the English name and the
 * ISO date. "Today" is the DISPLAY ZONE's today when a zone is given.
 */
export function buildDateCommands(
  now: Date,
  locale?: string | string[],
  zone?: string,
): DateCommand[] {
  const base = zone ? DateTime.fromJSDate(now, { zone }) : DateTime.fromJSDate(now);
  // Label formatting runs over a machine-local Date REBUILT from the
  // calendar-day parts — weekday names are day-of-calendar facts, zone-free.
  const at = (offset: number) => {
    const day = base.plus({ days: offset });
    return { iso: day.toFormat('yyyy-MM-dd'), date: new Date(day.year, day.month - 1, day.day) };
  };

  const english = (date: Date) =>
    new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date).toLowerCase();

  const relatives: DateCommand[] = ([-1, 0, 1] as const).map((offset) => {
    const { iso } = at(offset);
    const label = relativeLabel(offset, locale);
    const englishName = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : 'yesterday';

    return {
      id: `ai-date-${englishName}`,
      label,
      match: `${label} ${englishName} ${iso}`.toLowerCase(),
      iso,
    };
  });

  const weekdays: DateCommand[] = Array.from({ length: 7 }, (_, index) => {
    const { iso, date } = at(index + 1);
    const label = weekdayLabel(date, locale);

    return {
      id: `ai-date-weekday-${index}`,
      label,
      match: `${label} ${english(date)} ${iso}`.toLowerCase(),
      iso,
    };
  });

  return [...relatives, ...weekdays];
}
