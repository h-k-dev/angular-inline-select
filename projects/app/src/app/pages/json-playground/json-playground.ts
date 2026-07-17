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
import { MatTableModule } from '@angular/material/table';

// Components
import { AngularInlineJson } from '../../../../../angular-inline-select/json/src/angular-inline-json';
import { EditableErrorTemplate } from '../../../../../angular-inline-select/src/lib/angular-inline-text/editable-error';

interface ServiceRow {
  position: number;
  name: string;
  config: string;
}

interface FeatureFlagRow {
  flag: string;
  rules: string;
}

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
    MatTableModule,

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
  // Truncated preview: a 5,000-key object never renders more than 5 lines
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

  // ---------------------------------------------------------------------------
  // Material table example: one editable JSON config per service row
  // ---------------------------------------------------------------------------
  protected serviceColumns = ['position', 'name', 'config'];

  protected serviceRows: ServiceRow[] = [
    { position: 1, name: 'auth', config: '{"provider":"oauth2","scopes":["read","write"],"ttl":3600}' },
    { position: 2, name: 'cache', config: '{"driver":"redis","host":"10.0.0.5","port":6379,"ttl":300}' },
    { position: 3, name: 'mailer', config: '{"transport":"smtp","host":"smtp.example.com","secure":true}' },
    { position: 4, name: 'search', config: '{"engine":"elastic","shards":5,"replicas":1,"analyzer":"standard"}' },
    { position: 5, name: 'billing', config: '{"currency":"EUR","proration":true,"retries":[60,300,3600]}' },
    { position: 6, name: 'flags', config: '{}' },
  ];

  // ---------------------------------------------------------------------------
  // Plain HTML table example: display value | the raw string behind it
  // ---------------------------------------------------------------------------
  protected featureFlagRows: FeatureFlagRow[] = [
    { flag: 'new-editor', rules: '{"enabled":true,"rollout":0.25,"cohorts":["beta"]}' },
    { flag: 'dark-mode', rules: '{"enabled":true}' },
    { flag: 'export-csv', rules: '{"enabled":false,"reason":"pending-review"}' },
  ];

  // Event console: raw JSON-text payloads, newest first.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) => [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8));
  }
}
