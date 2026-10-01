// Angular
import {
  ChangeDetectionStrategy,
  Component,

  // Signals
  signal,
} from '@angular/core';

// Forms
import { FormField, form, readonly, disabled } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';

// Editables
import { AngularInlinePrompt } from '../../../../../angular-inline-select/prompt/src/angular-inline-prompt/angular-inline-prompt';

const SAMPLE = [
  '# Rolle',
  'Du extrahierst den Absender eines Dokuments.',
  '',
  '## Regeln',
  '1. Antworte nur mit dem Namen.',
  '2. Wenn mehrere genannt sind:',
  '   - nimm den ersten',
  '   - ignoriere Kopien',
  '3. Keine Adresse.',
].join('\n');

@Component({
  selector: 'app-prompt-playground',
  templateUrl: './prompt-playground.html',
  styleUrl: './prompt-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Forms
    FormField,

    // Material
    MatButtonModule,

    // Components
    AngularInlinePrompt,
  ],
})
export class PromptPlayground {
  // ---------------------------------------------------------------------------
  // Standalone [(value)] — the stored Markdown shown live beside it
  // ---------------------------------------------------------------------------
  protected prompt = signal(SAMPLE);

  // ---------------------------------------------------------------------------
  // Signal form — readonly / disabled through the Form Value Contract
  // ---------------------------------------------------------------------------
  protected fieldReadonly = signal(false);
  protected fieldDisabled = signal(false);

  protected model = signal({ query: '- Datum im Format `TT.MM.JJJJ`\n- sonst leer' });
  protected promptForm = form(this.model, (path) => {
    readonly(path.query, { when: () => this.fieldReadonly() });
    disabled(path.query, { when: () => this.fieldDisabled() });
  });

  // ---------------------------------------------------------------------------
  // Many — hundreds of prompts, only the one in use ever live
  // ---------------------------------------------------------------------------
  protected many = Array.from({ length: 900 }, (_, index) =>
    signal(index % 3 === 0 ? SAMPLE : `${index + 1}. Feld — Wert extrahieren`),
  );
  protected manyShown = signal(false);
  protected liveViews = signal(0);

  /** Counts the views actually mounted — the whole point of the lazy mount. */
  protected countLive(): void {
    this.liveViews.set(document.querySelectorAll('.iusta-prompt.ProseMirror').length);
  }
}
