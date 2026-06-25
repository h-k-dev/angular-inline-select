import {
  Component,
  inject,
  ElementRef,

  // Signals
  computed,
  output,
  model,
  viewChild,
  input,
  effect,
  untracked,
  linkedSignal,
} from '@angular/core';
import { FormValueControl, FormField, form, disabled, readonly, validate } from '@angular/forms/signals';

// Material
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

// CDK
import { OverlayModule } from '@angular/cdk/overlay';

// Directives
import { RestrictCharacters } from './directives/restrict-characters/restrict-characters';
import { NOOP_STRATEGY, RestrictStrategy } from './directives/restrict-characters/tokens';
import { EditableOverlayControl } from './directives/editable-overlay-control';
import { TextareaAutosize } from './directives/textarea-autosize';

// Components
import { EditableWrapper } from './editable-wrapper/editable-wrapper';

interface ValueNormalizationDetails {
  value: string;
  changed: boolean;
}

export function normalizeString(value: string): string {
  const trim = value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return trim;
}

@Component({
  selector: 'angular-inline-text',
  imports: [
    // CDK
    OverlayModule,

    // Material
    MatInputModule,
    MatIconModule,
    MatButtonModule,

    // Forms
    FormField,
    EditableOverlayControl,
    EditableWrapper,
    TextareaAutosize,

    // Directives
    RestrictCharacters,
  ],
  templateUrl: './angular-inline-text.html',
  styleUrl: './angular-inline-text.scss',
})
export class AngularInlineText implements FormValueControl<string> {
  signalForm = inject(FormField<string>, { optional: true });

  protected autosize = viewChild<TextareaAutosize>('autosize');
  protected overlayControl = viewChild(EditableOverlayControl);
  protected wrapper = viewChild(EditableWrapper);

  protected singleLineInput = viewChild<ElementRef<HTMLInputElement>>('singleLineInput');
  protected multiLineInput = viewChild<ElementRef<HTMLTextAreaElement>>('multiLineInput');

  // Signal Form Control
  // ---------------------------------------------------------------------------
  value = model('');

  /**
   * The local model is the model that is used to store the value of the control.
   */
  localModel = linkedSignal(() => this.value() ?? '');

  localForm =
    this.signalForm?.state ??
    form(this.localModel, (path) => {
      disabled(path, () => this.signalForm?.state()?.disabled() ?? false);
      readonly(path, () => this.signalForm?.state()?.readonly() ?? false);
      validate(path, () => {
        const valid = this.signalForm?.state()?.valid() ?? true;
        if (valid) return null;

        const errorSummary = this.signalForm?.state()?.errors() ?? [];
        return {
          kind: 'invalid',
          errors: errorSummary,
          message: errorSummary[0]?.message ?? 'Invalid value',
        };
      });
    });

  /**
   * This is the previous value of the control.
   * It is used to revert the value to the previous value if the control is reverted.
   */
  previous = linkedSignal({
    source: () => this.value(),
    computation: (source, previous): string => {
      const dirty = this.localForm().dirty();
      if (!dirty) return source;

      return previous ? previous.value : '';
    },
  });

  isEmpty = computed(() => {
    const control = this.overlayControl();

    if (!control) return false;
    return control.isEmpty() ?? false;
  });

  // ---------------------------------------------------------------------------
  // Editable Core
  // ---------------------------------------------------------------------------
  appearance = input<'outline' | 'fill'>('fill');
  savedModelChange = output<string>();
  showForm = model<boolean>(false);

  // Directives
  // ---------------------------------------------------------------------------
  restrictionStrategy = input<RestrictStrategy>(NOOP_STRATEGY);

  // Class Owned
  // ---------------------------------------------------------------------------
  isSingleLine = input<boolean>(false);
  placeholder = input<string>('N/A');

  // Inputs
  // ---------------------------------------------------------------------------

  /**
   * This will trim all surplus characters
   * - before emitting the value
   * - and after accepting setting the value to this normalized value
   */
  normalizeValue = input(false);

  /**
   * Normalization includes (a growing list of things to normalize):
   * - removed all surplus spaces
   * - removed all newlines
   */
  normalization = computed((): ValueNormalizationDetails => {
    const value = this.localForm()?.value() ?? '';
    const previous = this.previous();

    if (!this.normalizeValue()) {
      return {
        value,
        changed: value !== previous,
      };
    }

    const normalized = normalizeString(value);
    return {
      value: normalized,
      changed: normalized !== previous,
    };
  });

  // Handlers
  // -------------------------------------------------------------------------

  accepted = false;
  protected accept() {
    const { value, changed } = this.normalization();

    if (!changed) {
      this.showForm.set(false);
      this.localForm().reset();
      return;
    }

    // Validation check uses the activeForm state
    if (this.localForm().invalid()) return;

    this.accepted = true;

    // Fire the hard commit!
    this.savedModelChange.emit(value);
    this.showForm.set(false);

    if (this.isSingleLine()) {
      this.singleLineInput()?.nativeElement.blur();
    } else {
      this.multiLineInput()?.nativeElement.blur();
    }

    this.localForm().reset();
  }

  protected handleDetach() {
    if (this.accepted) return;

    const previous = this.previous();
    const current = this.localForm().value();

    // If they click away and it's different than the latched value, revert
    if (previous !== current) {
      this.localForm().reset(previous);
    }
  }

  protected handleCopied() {
    this.overlayControl()?.copyCurrent();
  }

  protected clearValue(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    this.value.set('');
    this.savedModelChange.emit('');
    this.localForm().reset();
  }

  provideAutosize() {
    if (this.isSingleLine()) return;

    return effect(() => {
      this.localForm().value();
      untracked(() => requestAnimationFrame(() => this.autosize()?.resize()));
    });
  }

  autoResetAccepted = effect(() => {
    if (this.showForm()) {
      untracked(() => (this.accepted = false));
    }
  });

  resize = effect(() => {
    // Move the check inside the effect
    if (this.isSingleLine()) return;

    this.localForm().value();
    untracked(() => requestAnimationFrame(() => this.autosize()?.resize()));
  });
}
