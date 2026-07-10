import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  input,
  output,
  type WritableSignal,
} from '@angular/core';

// Components
import {
  AngularInlineDate,
  AngularInlineDuration,
  AngularInlineTime,
  DateTimeRangeGroup,
  RangeDay,
  RangeStart,
  RangeEnd,
  RangeLength,
  composeDbEntry,
  type TemporalRangeValue,
} from 'angular-inline-select/temporal';

/**
 * The quartet in a TABLE — five rows, each ROW is one control: the group
 * directive sits on the <tr>, its value two-way bound per row. A plain
 * table, not mat-table: the leaves inject their group through the element
 * injector, so they must be template children of the row — matColumnDef
 * cell templates are declared on the table, not the row, and would all
 * resolve the same group. The night shift is seeded overnight (+1 badge);
 * typed overflow hours ("25:15") roll an end the same way.
 */
@Component({
  selector: 'app-quartet-table-card',
  templateUrl: './quartet-table-card.html',
  styleUrl: './quartet-table-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    AngularInlineDate,
    AngularInlineDuration,
    AngularInlineTime,
    DateTimeRangeGroup,
    RangeDay,
    RangeStart,
    RangeEnd,
    RangeLength,
  ],
})
export class QuartetTableCard {
  /** The page's locale, owned by the date card's toggle. */
  readonly locale = input<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected stayRows: { label: string; value: WritableSignal<TemporalRangeValue | null> }[] = [
    {
      label: 'Early',
      value: signal({
        start: composeDbEntry('2026-07-20', '06:00'),
        end: composeDbEntry('2026-07-20', '14:00'),
        duration: 28_800,
      }),
    },
    {
      label: 'Core',
      value: signal({
        start: composeDbEntry('2026-07-21', '09:00'),
        end: composeDbEntry('2026-07-21', '17:30'),
        duration: 30_600,
      }),
    },
    {
      label: 'Late',
      value: signal({
        start: composeDbEntry('2026-07-22', '13:15'),
        end: composeDbEntry('2026-07-22', '21:45'),
        duration: 30_600,
      }),
    },
    {
      label: 'Night',
      value: signal({
        start: composeDbEntry('2026-07-23', '22:00'),
        end: composeDbEntry('2026-07-24', '06:00'),
        duration: 28_800,
      }),
    },
    {
      label: 'On-call',
      value: signal({
        start: composeDbEntry('2026-07-24', '08:00'),
        end: composeDbEntry('2026-07-25', '20:00'),
        duration: 129_600,
      }),
    },
  ];

  /** The locale pinned to 24 h — military time survives `en`. */
  protected militaryLocale = computed(() => `${this.locale()}-u-hc-h23`);

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
