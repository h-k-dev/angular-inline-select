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

// Phone entry point: the only place in the app that carries phone bytes.
import { AngularInlinePhone, createLibphonenumberCodec } from 'angular-inline-select/phone';
import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';

// One codec per app: full min-metadata here; a DACH-only app would pass a
// generated subset instead (a few kB).
const phoneCodec = createLibphonenumberCodec(metadata, examples);

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
  protected codec = phoneCodec;

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

  protected contactModel = signal<{ phone: string | null }>({ phone: '+491712345678' });

  protected contactForm = form(this.contactModel, (path) => {
    required(path.phone, { when: () => this.fieldRequired() });
  });

  protected phoneMissing = computed(() =>
    this.contactForm.phone().errors().some((error) => error.kind === 'required'),
  );

  // Event console: E.164-typed payloads, newest first.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }
}
