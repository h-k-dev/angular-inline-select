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
  type DurationFormat,
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
  ],
})
export class TemporalPlayground {
  // ---------------------------------------------------------------------------
  // Date — signal form, ISO value, /today slash menu
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected dateLocale = signal<'de' | 'en'>('en');

  protected deadlineModel = signal<{ due: string | null }>({ due: '2026-07-20' });

  protected deadlineForm = form(this.deadlineModel, (path) => {
    required(path.due, { when: () => this.fieldRequired() });
  });

  protected dueMissing = computed(() =>
    this.deadlineForm.due().errors().some((error) => error.kind === 'required'),
  );

  // ---------------------------------------------------------------------------
  // Time — wall-clock string, native OS picker
  // ---------------------------------------------------------------------------
  protected startsAt = signal<string | null>('09:30');

  // ---------------------------------------------------------------------------
  // Duration — standalone [(value)] in seconds
  // ---------------------------------------------------------------------------
  protected durationFormat = signal<DurationFormat>('h:mm');
  protected estimate = signal<number | null>(5400);

  // ---------------------------------------------------------------------------
  // The quartet — stay · start · end · length in one signal form, deliberately
  // UNLINKED: the T5 DateTimeRangeGroup fixture (end >= start over composed
  // datetimes, duration = end − start, day edits shift both sides). Seeded
  // OVERNIGHT: the end is wall-clock-earlier than the start — exactly the
  // case the +1 day badge on the end field will make legible.
  // ---------------------------------------------------------------------------
  protected stayModel = signal<{
    /** ISO `'yyyy-MM-dd'`. */
    day: string | null;
    /** `'HH:mm'` — shown in 24 h via the `hc-h23` locale extension. */
    starts: string | null;
    /** `'HH:mm'` — the future +1 badge carrier. */
    ends: string | null;
    /** Seconds. */
    length: number | null;
  }>({
    day: '2026-07-21',
    starts: '21:00',
    ends: '06:00',
    length: 32_400,
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
