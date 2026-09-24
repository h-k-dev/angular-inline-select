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

// No engine here: every phone field shares the app-wide lazy one registered
// with `providePhoneCodec` in app.config.ts.
import { AngularInlinePhone } from 'angular-inline-select/phone';

@Component({
  selector: 'app-phone-playground',
  templateUrl: './phone-playground.html',
  styleUrl: './phone-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,

    // Forms
    FormField,

    // Components
    AngularInlinePhone,
  ],
})
export class PhonePlayground {
  // ---------------------------------------------------------------------------
  // Fresh-entry example — empty field, no pre-filled number
  // ---------------------------------------------------------------------------
  protected freshPhone = signal<string | null>(null);

  // ---------------------------------------------------------------------------
  // Standalone [(value)] example — any parseable string in, E.164 out
  // ---------------------------------------------------------------------------
  protected hotline = signal<string | null>('+493012345678');

  // ---------------------------------------------------------------------------
  // Signal form example: E.164 model + schema + live interpretation
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected fieldReadonly = signal(false);
  protected fieldDisabled = signal(false);

  protected displayFormat = signal<'national' | 'international'>('international');
  protected menuLocale = signal<'de' | 'en'>('en');

  protected contactModel = signal<{ phone: string | null }>({ phone: '+491712345678' });

  protected contactForm = form(this.contactModel, (path) => {
    required(path.phone, { when: () => this.fieldRequired() });
  });

  protected phoneMissing = computed(() =>
    this.contactForm
      .phone()
      .errors()
      .some((error) => error.kind === 'required'),
  );

  // Event console: E.164-typed payloads, newest first.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }
}
