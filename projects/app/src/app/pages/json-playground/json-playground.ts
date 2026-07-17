import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { FormField, form, required, readonly, disabled } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';

// Components
import { AngularInlineJson } from '../../../../../angular-inline-select/json/src/angular-inline-json';
import { EditableErrorTemplate } from '../../../../../angular-inline-select/src/lib/angular-inline-text/editable-error';

function buildLargeConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (let i = 0; i < 5000; i++) config[`setting${i}`] = i % 2 === 0;
  return config;
}

@Component({
  selector: 'app-json-playground',
  templateUrl: './json-playground.html',
  styleUrl: './json-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,

    // Forms
    FormField,

    // Components
    AngularInlineJson,
    EditableErrorTemplate,
  ],
})
export class JsonPlayground {
  // ---------------------------------------------------------------------------
  // Standalone [(value)] example — small object, one-line preview
  // ---------------------------------------------------------------------------
  protected profile = signal('{"role":"admin","active":true}');

  // ---------------------------------------------------------------------------
  // Truncated preview: a 40-key object never renders more than 5 lines
  // ---------------------------------------------------------------------------
  protected largeConfig = signal(JSON.stringify(buildLargeConfig()));

  // ---------------------------------------------------------------------------
  // Signal form example: required validation + field state toggles
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected fieldReadonly = signal(false);
  protected fieldDisabled = signal(false);

  protected metadataModel = signal<{ metadata: string }>({ metadata: '{"tags":["a","b"]}' });

  protected metadataForm = form(this.metadataModel, (path) => {
    required(path.metadata, { when: () => this.fieldRequired() });
    readonly(path.metadata, { when: () => this.fieldReadonly() });
    disabled(path.metadata, { when: () => this.fieldDisabled() });
  });

  protected metadataMissing = computed(() =>
    this.metadataForm.metadata().errors().some((error) => error.kind === 'required'),
  );

  // Event console: raw JSON-text payloads, newest first.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) => [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8));
  }
}
