import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { FormField, form, required, min, max, readonly, disabled } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Components
import { AngularInlineNumber } from '../../../../../angular-inline-select/src/lib/angular-inline-number/angular-inline-number';
import { EditableSuffix } from '../../../../../angular-inline-select/src/lib/angular-inline-text/editable-affix';

@Component({
  selector: 'app-number-playground',
  templateUrl: './number-playground.html',
  styleUrl: './number-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,
    MatIconModule,

    // Forms
    FormField,

    // Components
    AngularInlineNumber,
    EditableSuffix,
  ],
})
export class NumberPlayground {
  // ---------------------------------------------------------------------------
  // Standalone [(value)] example — strings coerce in, numbers come out
  // ---------------------------------------------------------------------------
  protected crewCount = signal<number | string | null>(12);

  protected crewCountType = computed(() =>
    this.crewCount() === null ? 'null' : typeof this.crewCount(),
  );

  // ---------------------------------------------------------------------------
  // Price example: codec formatting + suffix template
  // ---------------------------------------------------------------------------
  protected price = signal<number | null>(49.9);

  protected priceFormat = (value: number | null): string =>
    value === null ? '' : value.toFixed(2);

  // ---------------------------------------------------------------------------
  // Signal form example: numeric schema + field state toggles
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected fieldReadonly = signal(false);
  protected fieldDisabled = signal(false);

  protected cargoModel = signal<{ tonnage: number | null }>({ tonnage: 120 });

  protected cargoForm = form(this.cargoModel, (path) => {
    // The schema only decides validity — the error texts live in the
    // projected [editable-error] content (the mat-error split).
    required(path.tonnage, { when: () => this.fieldRequired() });
    min(path.tonnage, 0);
    max(path.tonnage, 500);

    readonly(path.tonnage, { when: () => this.fieldReadonly() });
    disabled(path.tonnage, { when: () => this.fieldDisabled() });
  });

  // The `hasError(...)` analogues — WHICH error the projected content
  // describes; WHEN errors show is the field's job. The parse gate is the
  // control's own signal (`#tonnage.parseFailed()` in the template) because
  // the synthetic parse error never reaches the outer field.
  protected tonnageMissing = computed(() =>
    this.cargoForm.tonnage().errors().some((error) => error.kind === 'required'),
  );

  protected tonnageOutOfRange = computed(() =>
    this.cargoForm
      .tonnage()
      .errors()
      .some((error) => error.kind === 'min' || error.kind === 'max'),
  );

  // Event console: number-typed payloads, newest first.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }
}
