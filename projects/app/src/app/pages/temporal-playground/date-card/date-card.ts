import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  model,
  output,
} from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';

// Components
import {
  AngularInlineDate,
  dayToDbEntry,
  dayEndToDbEntry,
  type IsoDateRange,
} from 'angular-inline-select/temporal';

/**
 * Date & date range — ONE form: the single deadline and the ranged vacation
 * live in the same card, so the card's toggles (required, locale, touched,
 * reset) apply to BOTH fields.
 */
@Component({
  selector: 'app-date-card',
  templateUrl: './date-card.html',
  styleUrl: './date-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatButtonModule, FormField, AngularInlineDate],
})
export class DateCard {
  /** The page's locale — two-way: this card's toggle drives the sibling cards too. */
  readonly locale = model<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected fieldRequired = signal(true);

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

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
