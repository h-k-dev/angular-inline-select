import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  input,
  output,
} from '@angular/core';
import { FormField, form } from '@angular/forms/signals';

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
  type TemporalRangeValue,
} from 'angular-inline-select/temporal';

/**
 * The quartet — T5b: the GROUP is the form control. ONE field, the domain
 * shape ({start, end, duration} — DB entries + seconds); the four leaves
 * are unbound surfaces the group feeds. Seeded OVERNIGHT: the end instant
 * is on the next day, so the end field wears the +1 badge.
 */
@Component({
  selector: 'app-quartet-card',
  templateUrl: './quartet-card.html',
  styleUrl: './quartet-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    FormField,
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
export class QuartetCard {
  /** The page's locale, owned by the date card's toggle. */
  readonly locale = input<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected stayModel = signal<TemporalRangeValue | null>({
    start: composeDbEntry('2026-07-21', '21:00'),
    end: composeDbEntry('2026-07-22', '06:00'),
    duration: 32_400,
  });

  protected stayForm = form(this.stayModel);

  /** The locale pinned to 24 h — military time survives `en`. */
  protected militaryLocale = computed(() => `${this.locale()}-u-hc-h23`);

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
