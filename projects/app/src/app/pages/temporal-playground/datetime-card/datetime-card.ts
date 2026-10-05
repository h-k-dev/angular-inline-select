import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  input,
  output,
  signal,
} from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';

// Material
import { MatFormFieldModule } from '@angular/material/form-field';

// Components
import { AngularInlineDateTime, composeDbEntry } from 'angular-inline-select/temporal';
import { InlineMatFormField } from 'angular-inline-select/temporal-mat';

/**
 * Date + time — ONE instant, two fields: the composite inline and inside
 * mat-form-fields, all bound to the SAME required model. In the mat boxes
 * the COMPOSITE is the form field's control (`inlineMatFormField` on it,
 * never on a leaf) — the shape of Material's own `mat-date-range-input`.
 */
@Component({
  selector: 'app-datetime-card',
  templateUrl: './datetime-card.html',
  styleUrl: './datetime-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatFormFieldModule, FormField, AngularInlineDateTime, InlineMatFormField],
})
export class DatetimeCard {
  /** The page's locale, owned by the date card's toggle. */
  readonly locale = input<'de' | 'en'>('en');

  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected model = signal<string | null>(composeDbEntry('2026-07-21', '09:30'));
  protected field = form(this.model, (path) => required(path));

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
