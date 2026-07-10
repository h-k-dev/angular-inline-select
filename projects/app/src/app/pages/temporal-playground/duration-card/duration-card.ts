import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  output,
} from '@angular/core';
import { FormField, form } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';

// Components
import { AngularInlineDuration, type DurationFormat } from 'angular-inline-select/temporal';

/**
 * Duration — form-driven: the model is seconds.
 */
@Component({
  selector: 'app-duration-card',
  templateUrl: './duration-card.html',
  styleUrl: './duration-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatButtonModule, FormField, AngularInlineDuration],
})
export class DurationCard {
  /** Every settled commit, for the page's event console. */
  readonly emitted = output<{ name: string; payload: unknown }>();

  protected durationFormat = signal<DurationFormat>('h:mm');
  protected durationModel = signal<{ estimate: number | null }>({ estimate: 5400 });
  protected durationForm = form(this.durationModel);

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
