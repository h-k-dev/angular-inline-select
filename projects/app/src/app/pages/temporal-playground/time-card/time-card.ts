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
import { MatButtonModule } from '@angular/material/button';

// Components
import {
  AngularInlineTime,
  composeDbEntry,
  type DbTimeRange,
} from 'angular-inline-select/temporal';

/**
 * Time & time range — ONE form: the single instant and the ranged shift
 * share the card's native-picker toggle. Models are full UTC instants
 * carrying their day; the shift is seeded OVERNIGHT so the end instant is
 * next-day and wears the intrinsic +1 badge.
 */
@Component({
  selector: 'app-time-card',
  templateUrl: './time-card.html',
  styleUrl: './time-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatButtonModule, FormField, AngularInlineTime],
})
export class TimeCard {
  /** The page's locale, owned by the date card's toggle. */
  readonly locale = input<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

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

  /** The locale pinned to 24 h — military time survives `en`. */
  protected militaryLocale = computed(() => `${this.locale()}-u-hc-h23`);

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
