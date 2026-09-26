import { Injectable, inject } from '@angular/core';
import { DateTime } from 'luxon';

import { todayIn, type ZoneId } from '../datetime/db-entry';
import { addDays, isIsoDate, type IsoDate } from '../datetime/iso-date';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';
import {
  INLINE_FILTER_DIALECT,
  type DayColumn,
  type FilterClause,
  type InlineFilterDialect,
} from './filter-dialect';

/**
 * Calendar days, END INCLUDED — what a person picks ("29 Sep – 5 Oct"
 * covers the 5th). A `null` side is open-ended: `{ start: null, end }` is
 * "up to and including `end`".
 */
export interface DayRange {
  start: IsoDate | null;
  end: IsoDate | null;
}

/** A named RELATIVE range — resolved against "today" whenever it is read, so it never goes stale. */
export interface DateFilterPreset {
  /** Stable id: the preset's identity in a filter value and its name in a URL (`?dueAt=overdue`). */
  id: string;
  /** What the panel shows — already localized. */
  label: string;
  /** The days the preset covers on `today`. */
  range(today: IsoDate): DayRange;
}

/** A filter value naming a preset — relative, resolved on every read. */
export interface DatePresetFilter {
  preset: string;
}

/**
 * The value of a filter-mode date field: a preset, explicit days, or `null`
 * — no filter (the ONE "off" state; explicit days always hold at least one
 * side). Plain data, so it serializes into a URL and back unchanged.
 */
export type DateFilter = DatePresetFilter | DayRange | null;

export function isPresetFilter(filter: DateFilter): filter is DatePresetFilter {
  return filter !== null && 'preset' in filter;
}

/** Explicit days as a filter value — `null` when neither side holds a day. */
export function dayRangeFilter(range: DayRange): DateFilter {
  return range.start === null && range.end === null ? null : { start: range.start, end: range.end };
}

/**
 * The days a filter covers on `today`, sorted; `null` for no filter or a
 * preset id nobody declared (an unknown `?dueAt=` never reaches a query).
 */
export function resolveDateFilter(
  filter: DateFilter,
  presets: readonly DateFilterPreset[],
  today: IsoDate,
): DayRange | null {
  if (filter === null) return null;

  const range = isPresetFilter(filter)
    ? presets.find((preset) => preset.id === filter.preset)?.range(today)
    : filter;
  if (range === undefined || (range.start === null && range.end === null)) return null;

  const { start, end } = range;
  // ISO days compare lexicographically.
  return start !== null && end !== null && start > end
    ? { start: end, end: start }
    : { start, end };
}

export function dateFiltersEqual(a: DateFilter, b: DateFilter): boolean {
  if (a === null || b === null) return a === b;
  if (isPresetFilter(a) || isPresetFilter(b)) {
    return isPresetFilter(a) && isPresetFilter(b) && a.preset === b.preset;
  }
  return a.start === b.start && a.end === b.end;
}

/**
 * The clause for "the property's day lies in `range`" — HALF-OPEN on the
 * wire: `>= start's midnight` and `< the midnight after end`. Precise at any
 * column precision (no `23:59:59` guess, no inclusive `between` dropping the
 * last day of an instant column), open sides simply absent, no range at all
 * `undefined`.
 */
export function dayRangeClause(
  dialect: InlineFilterDialect,
  property: string,
  range: DayRange | null,
  column: DayColumn,
  zone: ZoneId,
): FilterClause | undefined {
  if (range === null) return undefined;

  const from =
    range.start === null
      ? null
      : dialect.gte(property, dialect.dayBoundary(range.start, column, zone));
  const until =
    range.end === null
      ? null
      : dialect.lt(property, dialect.dayBoundary(addDays(range.end, 1), column, zone));

  if (from !== null && until !== null) return dialect.and([from, until]);
  return from ?? until ?? undefined;
}

// -- The URL codec -------------------------------------------------------------

/** An open interval side, per the OGC API – Features / STAC `datetime` notation. */
const OPEN = '..';

const PRESET_ID = /^[A-Za-z][\w-]*$/;

/**
 * A filter from its URL parameter — the ISO 8601 interval notation of the
 * OGC API – Features / STAC `datetime` parameter, plus preset ids:
 *
 * - `2026-09-29/2026-10-05` — explicit days, both included;
 * - `2026-09-29/..`, `../2026-09-28` — one side open;
 * - `2026-09-29` — that one day;
 * - `overdue` — a preset, by id;
 * - absent or unreadable → `null`, no filter.
 *
 * Shaped as an input `transform`: `dueAt = input(null, { transform: parseDateFilterParam })`.
 */
export function parseDateFilterParam(raw: string | null | undefined): DateFilter {
  const text = raw?.trim() ?? '';
  if (text === '') return null;

  if (!text.includes('/')) {
    if (isIsoDate(text)) return { start: text, end: text };
    return PRESET_ID.test(text) ? { preset: text } : null;
  }

  const parts = text.split('/');
  if (parts.length !== 2) return null;

  const [start, end] = parts.map((part) =>
    part === OPEN || part === '' ? null : isIsoDate(part) ? part : undefined,
  );
  if (start === undefined || end === undefined) return null;

  return dayRangeFilter({ start, end });
}

/** The URL parameter of a filter — {@link parseDateFilterParam}'s inverse; `null` = drop the parameter. */
export function formatDateFilterParam(filter: DateFilter): string | null {
  if (filter === null) return null;
  if (isPresetFilter(filter)) return filter.preset;
  if (filter.start === null && filter.end === null) return null;
  if (filter.start === filter.end) return filter.start;

  return `${filter.start ?? OPEN}/${filter.end ?? OPEN}`;
}

// -- The compiler --------------------------------------------------------------

export interface DateFilterClauseOptions {
  /** What the property holds (default `'date'`). */
  column?: DayColumn;
  /** The presets a `{ preset }` value may name. */
  presets?: readonly DateFilterPreset[];
  /** The zone whose calendar the days are (default: `INLINE_TEMPORAL_ZONE`, then the machine zone). */
  zone?: ZoneId;
  /** The moment "today" is read at (default: now). */
  now?: Date;
}

/**
 * Filter values → clauses, outside any control — for a table deriving its
 * `where` from a filter signal (route-seeded, set by a widget card) and for
 * counts that must match the table exactly. Compiles with the same dialect
 * and zone as a filter-mode control, so the two can never disagree.
 *
 *     dueAtClause = computed(() =>
 *       this.#dates.clause('dueAt', this.dueAt(), { presets: DUE_DATE_PRESETS }),
 *     );
 */
@Injectable({ providedIn: 'root' })
export class DateFilterCompiler {
  #dialect = inject(INLINE_FILTER_DIALECT);
  #zone = inject(INLINE_TEMPORAL_ZONE, { optional: true });

  /** "Today" in the display zone — what relative presets resolve against. */
  today(now: Date = DateTime.now().toJSDate(), zone: ZoneId = this.#zone?.()): IsoDate {
    return todayIn(now, zone);
  }

  /** The days a filter covers today (`null`: no filter). */
  resolve(filter: DateFilter, options: DateFilterClauseOptions = {}): DayRange | null {
    const zone = options.zone ?? this.#zone?.();
    return resolveDateFilter(filter, options.presets ?? [], this.today(options.now, zone));
  }

  /** The filter's clause on `property` — `undefined` when it filters nothing. */
  clause(
    property: string,
    filter: DateFilter,
    options: DateFilterClauseOptions = {},
  ): FilterClause | undefined {
    const zone = options.zone ?? this.#zone?.();
    return dayRangeClause(
      this.#dialect,
      property,
      this.resolve(filter, options),
      options.column ?? 'date',
      zone,
    );
  }
}
