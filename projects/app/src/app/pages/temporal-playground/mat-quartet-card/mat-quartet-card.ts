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

// Material
import { MatFormFieldModule } from '@angular/material/form-field';

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
import { InlineMatFormField } from 'angular-inline-select/temporal-mat';

/**
 * The quartet in MAT-FORM-FIELDS (T4): same group, same unbound leaves —
 * each hosted by <mat-form-field> via the temporal-mat adapter. The
 * controls stay mat-ignorant; the adapter derives MatFormFieldControl
 * from their public signals.
 */
@Component({
  selector: 'app-mat-quartet-card',
  templateUrl: './mat-quartet-card.html',
  styleUrl: './mat-quartet-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatFormFieldModule,
    InlineMatFormField,
    FormField,
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
export class MatQuartetCard {
  /** The page's locale, owned by the date card's toggle. */
  readonly locale = input<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected matStayModel = signal<TemporalRangeValue | null>({
    start: composeDbEntry('2026-07-21', '21:00'),
    end: composeDbEntry('2026-07-22', '06:00'),
    duration: 32_400,
  });

  protected matStayForm = form(this.matStayModel);

  /** The locale pinned to 24 h — military time survives `en`. */
  protected militaryLocale = computed(() => `${this.locale()}-u-hc-h23`);

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
