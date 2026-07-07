import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
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
  // Date — signal form, ISO value, /today slash menu
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected dateLocale = signal<'de' | 'en'>('en');

  protected deadlineModel = signal<{ due: string | null }>({ due: dayToDbEntry('2026-07-20') });

  protected deadlineForm = form(this.deadlineModel, (path) => {
    required(path.due, { when: () => this.fieldRequired() });
  });

  protected dueMissing = computed(() =>
    this.deadlineForm.due().errors().some((error) => error.kind === 'required'),
  );

  // ---------------------------------------------------------------------------
  // Time — form-driven: the model is a full UTC instant carrying its day
  // ---------------------------------------------------------------------------
  protected timeModel = signal<{ starts: string | null }>({
    starts: composeDbEntry('2026-07-20', '09:30'),
  });
  protected timeForm = form(this.timeModel);

  /** Native mode: the field itself opens the OS picker — no 🕐 suffix. */
  protected nativeTimePicker = signal(false);

  // ---------------------------------------------------------------------------
  // Duration — form-driven: the model is seconds
  // ---------------------------------------------------------------------------
  protected durationFormat = signal<DurationFormat>('h:mm');
  protected durationModel = signal<{ estimate: number | null }>({ estimate: 5400 });
  protected durationForm = form(this.durationModel);

  // ---------------------------------------------------------------------------
  // Date range — shape-echo: the OBJECT binding turns the ONE date control
  // ranged; model start = startOf('day'), end = endOf('day') in UTC.
  // ---------------------------------------------------------------------------
  protected dateRangeModel = signal<{ vacation: IsoDateRange | null }>({
    vacation: { start: dayToDbEntry('2026-07-21'), end: dayEndToDbEntry('2026-07-24') },
  });
  protected dateRangeForm = form(this.dateRangeModel);

  // ---------------------------------------------------------------------------
  // Time range — the group with ONLY rangeStart/rangeEnd registered; the
  // model binds {start, end} WITHOUT a duration key (shape-echoed away).
  // Seeded overnight: the end instant is next-day, so it wears the +1 badge.
  // ---------------------------------------------------------------------------
  protected shiftModel = signal<TemporalRangeValue | null>({
    start: composeDbEntry('2026-07-21', '22:00'),
    end: composeDbEntry('2026-07-22', '01:30'),
  });
  protected shiftForm = form(this.shiftModel);

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

  // ---------------------------------------------------------------------------
  // T6 — the display zone is CONFIGURATION, the value is not: one UTC
  // instant, three walls. `zone` per field here; app-wide via
  // `provideInlineTemporalZone` (iusta's ServerSideDatetimeConfiguration).
  // ---------------------------------------------------------------------------
  protected zonedInstant = signal<string | null>(composeDbEntry('2026-07-21', '21:00'));

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
