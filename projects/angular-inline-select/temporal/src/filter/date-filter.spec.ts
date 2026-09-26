import { TestBed } from '@angular/core/testing';

import { provideInlineTemporalZone } from '../datetime/zone';
import {
  DateFilterCompiler,
  dateFiltersEqual,
  dayRangeClause,
  formatDateFilterParam,
  parseDateFilterParam,
  resolveDateFilter,
  type DateFilter,
  type DateFilterPreset,
} from './date-filter';
import { LB3_FILTER_DIALECT, provideInlineFilterDialect } from './filter-dialect';

const PRESETS: DateFilterPreset[] = [
  { id: 'overdue', label: 'Overdue', range: (today) => ({ start: null, end: minusOne(today) }) },
  { id: 'today', label: 'Today', range: (today) => ({ start: today, end: today }) },
];

function minusOne(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

describe('resolveDateFilter', () => {
  it('reads explicit days as they are, and a preset against today', () => {
    expect(resolveDateFilter({ start: '2026-09-29', end: null }, PRESETS, '2026-09-26')).toEqual({
      start: '2026-09-29',
      end: null,
    });
    expect(resolveDateFilter({ preset: 'overdue' }, PRESETS, '2026-09-26')).toEqual({
      start: null,
      end: '2026-09-25',
    });
  });

  it('sorts an inverted pair (a hand-written URL)', () => {
    expect(resolveDateFilter({ start: '2026-10-05', end: '2026-09-29' }, [], '2026-09-26')).toEqual(
      {
        start: '2026-09-29',
        end: '2026-10-05',
      },
    );
  });

  it('is no filter for null, empty days, or a preset nobody declared', () => {
    expect(resolveDateFilter(null, PRESETS, '2026-09-26')).toBeNull();
    expect(resolveDateFilter({ start: null, end: null }, PRESETS, '2026-09-26')).toBeNull();
    expect(resolveDateFilter({ preset: 'someday' }, PRESETS, '2026-09-26')).toBeNull();
  });
});

describe('dayRangeClause (LoopBack 3)', () => {
  const clause = (
    range: { start: string | null; end: string | null } | null,
    column: 'date' | 'instant' = 'date',
  ) => dayRangeClause(LB3_FILTER_DIALECT, 'dueAt', range, column, 'Europe/Berlin');

  it('speaks both sides HALF-OPEN, as two single-operator conditions', () => {
    expect(clause({ start: '2026-09-29', end: '2026-10-05' })).toEqual({
      and: [{ dueAt: { gte: '2026-09-29 00:00:00' } }, { dueAt: { lt: '2026-10-06 00:00:00' } }],
    });
  });

  it('drops an open side instead of guessing a bound', () => {
    expect(clause({ start: '2026-09-29', end: null })).toEqual({
      dueAt: { gte: '2026-09-29 00:00:00' },
    });
    expect(clause({ start: null, end: '2026-09-28' })).toEqual({
      dueAt: { lt: '2026-09-29 00:00:00' },
    });
  });

  it('selects one day for a single-day range, across month and year ends', () => {
    expect(clause({ start: '2026-12-31', end: '2026-12-31' })).toEqual({
      and: [{ dueAt: { gte: '2026-12-31 00:00:00' } }, { dueAt: { lt: '2027-01-01 00:00:00' } }],
    });
  });

  it('never puts two operators on one key (the LoopBack SQL connector reads only the first)', () => {
    const both = clause({ start: '2026-05-12', end: '2026-05-14' }) as {
      and: Record<string, object>[];
    };
    for (const condition of both.and) expect(Object.keys(condition['dueAt'])).toHaveLength(1);
  });

  it('says nothing without a range', () => {
    expect(clause(null)).toBeUndefined();
  });

  it('follows DST in the zone on an instant column', () => {
    expect(clause({ start: '2026-10-25', end: null }, 'instant')).toEqual({
      dueAt: { gte: '2026-10-24T22:00:00.000Z' },
    });
    expect(clause({ start: null, end: '2026-10-25' }, 'instant')).toEqual({
      dueAt: { lt: '2026-10-25T23:00:00.000Z' },
    });
  });

  it('bounds an instant column by the display zone midnights, as UTC instants', () => {
    expect(clause({ start: '2026-09-29', end: '2026-09-29' }, 'instant')).toEqual({
      and: [
        { dueAt: { gte: '2026-09-28T22:00:00.000Z' } },
        { dueAt: { lt: '2026-09-29T22:00:00.000Z' } },
      ],
    });
  });
});

describe('the URL parameter (OGC API – Features / STAC interval notation)', () => {
  const cases: [string, DateFilter][] = [
    ['2026-09-29/2026-10-05', { start: '2026-09-29', end: '2026-10-05' }],
    ['2026-09-29/..', { start: '2026-09-29', end: null }],
    ['../2026-09-28', { start: null, end: '2026-09-28' }],
    ['2026-09-29', { start: '2026-09-29', end: '2026-09-29' }],
    ['overdue', { preset: 'overdue' }],
  ];

  it.each(cases)('%s round-trips', (param, filter) => {
    expect(parseDateFilterParam(param)).toEqual(filter);
    expect(formatDateFilterParam(filter)).toBe(param);
  });

  it('reads anything unreadable as no filter — nothing untrusted reaches a query', () => {
    for (const raw of [
      undefined,
      null,
      '',
      '../..',
      '2026-02-30/..',
      'a/b/c',
      '2026-09-29/soon',
      '{"gte":1}',
    ]) {
      expect(parseDateFilterParam(raw)).toBeNull();
    }
  });

  it('drops the parameter for no filter', () => {
    expect(formatDateFilterParam(null)).toBeNull();
  });
});

describe('dateFiltersEqual', () => {
  it('compares presets by id and days by value', () => {
    expect(dateFiltersEqual({ preset: 'today' }, { preset: 'today' })).toBe(true);
    expect(dateFiltersEqual({ preset: 'today' }, { start: '2026-09-26', end: '2026-09-26' })).toBe(
      false,
    );
    expect(
      dateFiltersEqual({ start: '2026-09-26', end: null }, { start: '2026-09-26', end: null }),
    ).toBe(true);
    expect(dateFiltersEqual(null, null)).toBe(true);
    expect(dateFiltersEqual(null, { preset: 'today' })).toBe(false);
  });
});

describe('DateFilterCompiler', () => {
  const NOW = new Date('2026-09-26T10:00:00Z');

  it('compiles with the injected dialect and zone — the same clause a filter-mode control speaks', () => {
    TestBed.configureTestingModule({ providers: [provideInlineTemporalZone('Europe/Berlin')] });
    const compiler = TestBed.inject(DateFilterCompiler);

    expect(compiler.clause('dueAt', { preset: 'overdue' }, { presets: PRESETS, now: NOW })).toEqual(
      {
        dueAt: { lt: '2026-09-26 00:00:00' },
      },
    );
    expect(
      compiler.clause(
        'arrival',
        { preset: 'today' },
        { presets: PRESETS, now: NOW, column: 'instant' },
      ),
    ).toEqual({
      and: [
        { arrival: { gte: '2026-09-25T22:00:00.000Z' } },
        { arrival: { lt: '2026-09-26T22:00:00.000Z' } },
      ],
    });
    expect(compiler.clause('dueAt', null)).toBeUndefined();
  });

  it('takes a dialect override member by member', () => {
    TestBed.configureTestingModule({
      providers: [provideInlineFilterDialect({ dayBoundary: (day) => `${day}T00:00:00Z` })],
    });
    const compiler = TestBed.inject(DateFilterCompiler);

    expect(compiler.clause('dueAt', { start: '2026-09-29', end: null })).toEqual({
      dueAt: { gte: '2026-09-29T00:00:00Z' },
    });
  });
});
