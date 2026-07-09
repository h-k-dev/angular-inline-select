import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  type WritableSignal,
} from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';

// Material
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';

// Components
import {
  AngularInlineDate,
  AngularInlineDuration,
  AngularInlineTime,
  DateTimeRangeGroup,
  RangeDay,
  RangeEndDay,
  RangeStart,
  RangeEnd,
  RangeLength,
  composeDbEntry,
  dayToDbEntry,
  dayEndToDbEntry,
  type DbTimeRange,
  type DurationFormat,
  type TemporalRangeValue,
  type IsoDateRange,
} from 'angular-inline-select/temporal';
import { InlineMatFormField } from 'angular-inline-select/temporal-mat';

@Component({
  selector: 'app-temporal-playground',
  templateUrl: './temporal-playground.html',
  styleUrl: './temporal-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [provideNativeDateAdapter()],
  imports: [
    // Material
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    InlineMatFormField,

    // Forms
    FormField,

    // Components
    AngularInlineDate,
    AngularInlineDuration,
    AngularInlineTime,
    DateTimeRangeGroup,
    RangeDay,
    RangeEndDay,
    RangeStart,
    RangeEnd,
    RangeLength,
  ],
})
export class TemporalPlayground {
  // ---------------------------------------------------------------------------
  // Date & date range — ONE form: the single deadline and the ranged vacation
  // live in the same card, so the card's toggles (required, locale, touched,
  // reset) apply to BOTH fields.
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected dateLocale = signal<'de' | 'en'>('en');

  protected dateModel = signal<{ due: string | null; vacation: IsoDateRange | null }>({
    due: dayToDbEntry('2026-07-20'),
    vacation: { start: dayToDbEntry('2026-07-21'), end: dayEndToDbEntry('2026-07-24') },
  });

  protected dateForm = form(this.dateModel, (path) => {
    required(path.due, { when: () => this.fieldRequired() });
    required(path.vacation, { when: () => this.fieldRequired() });
  });

  protected dueMissing = computed(() =>
    this.dateForm.due().errors().some((error) => error.kind === 'required'),
  );

  protected resetDateFields() {
    this.dateForm.due().reset();
    this.dateForm.vacation().reset();
  }

  // ---------------------------------------------------------------------------
  // Time & time range — ONE form: the single instant and the ranged shift
  // share the card's native-picker toggle. Models are full UTC instants
  // carrying their day; the shift is seeded OVERNIGHT so the end instant is
  // next-day and wears the intrinsic +1 badge.
  // ---------------------------------------------------------------------------
  protected timeModel = signal<{ starts: string | null; shift: DbTimeRange | null }>({
    starts: composeDbEntry('2026-07-20', '09:30'),
    shift: {
      start: composeDbEntry('2026-07-21', '22:00'),
      end: composeDbEntry('2026-07-22', '01:30'),
    },
  });
  protected timeForm = form(this.timeModel);

  /** Native mode: the fields themselves open the OS picker — no 🕐 suffix. */
  protected nativeTimePicker = signal(false);

  // ---------------------------------------------------------------------------
  // Duration — form-driven: the model is seconds
  // ---------------------------------------------------------------------------
  protected durationFormat = signal<DurationFormat>('h:mm');
  protected durationModel = signal<{ estimate: number | null }>({ estimate: 5400 });
  protected durationForm = form(this.durationModel);

  // ---------------------------------------------------------------------------
  // The quartet — T5b: the GROUP is the form control. ONE field, the domain
  // shape ({start, end, duration} — DB entries + seconds); the four leaves
  // are unbound surfaces the group feeds. Seeded OVERNIGHT: the end instant
  // is on the next day, so the end field wears the +1 badge.
  // ---------------------------------------------------------------------------
  protected stayModel = signal<TemporalRangeValue | null>({
    start: composeDbEntry('2026-07-21', '21:00'),
    end: composeDbEntry('2026-07-22', '06:00'),
    duration: 32_400,
  });

  protected stayForm = form(this.stayModel);

  // ---------------------------------------------------------------------------
  // The quartet in a TABLE — five rows, each ROW is one control: the group
  // directive sits on the <tr>, its value two-way bound per row. A plain
  // table, not mat-table: the leaves inject their group through the element
  // injector, so they must be template children of the row — matColumnDef
  // cell templates are declared on the table, not the row, and would all
  // resolve the same group. The night shift is seeded overnight (+1 badge);
  // typed overflow hours ("25:15") roll an end the same way.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // The quartet in MAT-FORM-FIELDS (T4): same group, same unbound leaves —
  // each hosted by <mat-form-field> via the temporal-mat adapter. The
  // controls stay mat-ignorant; the adapter derives MatFormFieldControl
  // from their public signals.
  // ---------------------------------------------------------------------------
  protected matStayModel = signal<TemporalRangeValue | null>({
    start: composeDbEntry('2026-07-21', '21:00'),
    end: composeDbEntry('2026-07-22', '06:00'),
    duration: 32_400,
  });

  protected matStayForm = form(this.matStayModel);

  /** The page's locale toggle, pinned to 24 h — military time survives `en`. */
  protected militaryLocale = computed(() => `${this.dateLocale()}-u-hc-h23`);

  // Event console: newest first.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }
}
