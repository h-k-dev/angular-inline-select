import { InjectionToken, type Provider } from '@angular/core';

import { dayToDbEntry, type ZoneId } from '../datetime/db-entry';
import type { IsoDate } from '../datetime/iso-date';

/**
 * A filter clause — a JSON where-fragment on one property (LoopBack's
 * `{ dueAt: { gte: … } }`, and the object filters of most REST/ORM
 * backends). A table ANDs the clauses of its filters into its `where`; a
 * filter with nothing to say contributes `undefined`, never an empty object.
 */
export type FilterClause = Record<string, unknown>;

/**
 * What a filtered property holds — how a calendar day is spoken on the wire:
 * - `'date'`: a date-only column (a due date, a birthday);
 * - `'instant'`: a point in time (`createdAt`, an arrival), whose day
 *   boundaries are the midnights of the display zone.
 */
export type DayColumn = 'date' | 'instant';

/**
 * THE backend vocabulary a filter-mode control compiles to — one dialect
 * per backend, two groups: the OPERATORS a condition is written with, and
 * how a day BOUNDARY is written as a value. Everything above it (which days
 * a range covers, half-open bounds, open-ended sides) is dialect-free and
 * written once, in `date-filter.ts`.
 *
 * Operators never merge into one object: each call is one condition, and
 * `and` composes them — a backend that reads several operators per key can
 * still take the composed form, while one that reads only the first (the
 * LoopBack SQL connector) would otherwise drop the rest silently.
 */
export interface InlineFilterDialect {
  /** `property >= value`. */
  gte(property: string, value: unknown): FilterClause;
  /** `property < value`. */
  lt(property: string, value: unknown): FilterClause;
  /** Every clause holds. */
  and(clauses: readonly FilterClause[]): FilterClause;
  /** The value of a calendar day's START (its midnight) on a `column`. */
  dayBoundary(day: IsoDate, column: DayColumn, zone: ZoneId): unknown;
}

/**
 * The LoopBack 3 dialect — the default. Day boundaries follow the MySQL
 * `DATETIME` convention of a date-only column (`'2026-09-29 00:00:00'`: an
 * offset-less wall clock, so it lands on midnight whatever zone the server
 * runs in) and UTC ISO instants for instant columns.
 */
export const LB3_FILTER_DIALECT: InlineFilterDialect = {
  gte: (property, value) => ({ [property]: { gte: value } }),
  lt: (property, value) => ({ [property]: { lt: value } }),
  and: (clauses) => ({ and: [...clauses] }),
  dayBoundary: (day, column, zone) =>
    column === 'date' ? `${day} 00:00:00` : dayToDbEntry(day, zone),
};

/** The dialect every filter-mode control and `DateFilterCompiler` compiles with. */
export const INLINE_FILTER_DIALECT = new InjectionToken<InlineFilterDialect>(
  'INLINE_FILTER_DIALECT',
  {
    providedIn: 'root',
    factory: () => LB3_FILTER_DIALECT,
  },
);

/**
 * Swaps the dialect — whole, or member by member over LoopBack 3:
 *
 *     provideInlineFilterDialect({ dayBoundary: (day) => `${day}T00:00:00Z` })
 */
export function provideInlineFilterDialect(dialect: Partial<InlineFilterDialect>): Provider {
  return { provide: INLINE_FILTER_DIALECT, useValue: { ...LB3_FILTER_DIALECT, ...dialect } };
}
