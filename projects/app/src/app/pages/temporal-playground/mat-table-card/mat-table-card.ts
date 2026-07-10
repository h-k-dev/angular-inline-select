import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  input,
  output,
} from '@angular/core';
import { MatTableModule } from '@angular/material/table';

// Components
import {
  AngularInlineDate,
  AngularInlineDuration,
  AngularInlineTime,
  RangeDay,
  RangeTimes,
  RangeLength,
  composeDbEntry,
  createTemporalRangeGroup,
  type TemporalRangeGroup,
  type TemporalRangeValue,
} from 'angular-inline-select/temporal';

interface ShiftRow {
  label: string;
  group: TemporalRangeGroup;
}

/**
 * The HEADLESS group in a MAT-TABLE — the case the DI directive cannot
 * serve: `matColumnDef` cell templates are declared on the table, not the
 * row, so a per-row `dateTimeRangeGroup` directive is unreachable through
 * the element injector. Instead each row's DATA carries its own
 * `createTemporalRangeGroup()` and the leaves connect BY REFERENCE
 * (`[rangeDay]="row.group"` …) — same laws, no DI. This fixture mirrors
 * iusta's time-entry table exactly.
 */
@Component({
  selector: 'app-mat-table-card',
  templateUrl: './mat-table-card.html',
  styleUrl: './mat-table-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatTableModule,
    AngularInlineDate,
    AngularInlineDuration,
    AngularInlineTime,
    RangeDay,
    RangeTimes,
    RangeLength,
  ],
})
export class MatTableCard {
  /** The page's locale, owned by the date card's toggle. */
  readonly locale = input<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected columns = ['label', 'day', 'times', 'length'];

  // Component field initializer = injection context; the factory registers
  // its effects here. Each row is its own group — its own laws, its own value.
  protected rows: ShiftRow[] = (
    [
      { label: 'Early', day: '2026-07-20', start: '06:00', end: '14:00', duration: 28_800 },
      { label: 'Core', day: '2026-07-21', start: '09:00', end: '17:30', duration: 30_600 },
      { label: 'Night', day: '2026-07-23', start: '22:00', end: '06:00', duration: 28_800, endDay: '2026-07-24' },
    ] as { label: string; day: string; start: string; end: string; duration: number; endDay?: string }[]
  ).map(({ label, day, start, end, duration, endDay }) => ({
    label,
    group: createTemporalRangeGroup({
      value: signal<TemporalRangeValue | null>({
        start: composeDbEntry(day, start),
        end: composeDbEntry(endDay ?? day, end),
        duration,
      }),
      onChanges: (changes) =>
        this.emitted.emit({ name: `matTable.${label}.savedModelChange`, payload: changes.composed }),
    }),
  }));

  /** The locale pinned to 24 h — military time survives `en`. */
  protected militaryLocale = computed(() => `${this.locale()}-u-hc-h23`);
}
