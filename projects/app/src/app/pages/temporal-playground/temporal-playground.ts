import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';

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
  dayToDbEntry,
  dayEndToDbEntry,
  type DurationFormat,
  type TemporalRangeValue,
  type IsoDateRange,
} from 'angular-inline-select/temporal';

@Component({
  selector: 'app-temporal-playground',
  templateUrl: './temporal-playground.html',
  styleUrl: './temporal-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,

    // Forms
    FormField,

    // Components
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
