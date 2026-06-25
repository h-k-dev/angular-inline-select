import {
  Directive,
  inject,
  ElementRef,

  // Signals
  input,
  computed,
  signal,
  linkedSignal,
  type WritableSignal,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';

/**
 * Directive to control the overlay of the editable component. This is used to
 * - open and close the overlay of the editable component.
 * - set the class of the editable component based on the state of the control.
 */
@Directive({
  selector: '[mEditableOverlayControl]',
  exportAs: 'editableOverlayControl',
  host: {
    class: 'iusta-editable',
    '[class.iusta-editable--empty]': 'isOpen() === false && isEmpty()',
    '[class.iusta-editable--filled]': 'isOpen() === false && !isEmpty()',
    '(focus)': 'showSignal().set(true)',
    '(blur)': 'onBlur($event)',
  },
})
export class EditableOverlayControl<T> {
  host = inject<ElementRef<HTMLElement>>(ElementRef);
  #control = inject(FormField<T>, { optional: true });

  mEditableOverlayControl = input.required<{
    showSignal: WritableSignal<boolean>;
    localForm?: FieldTree<T>;
  }>();

  /**
   * This control expects the distinction between local form and injected form.
   * The injected form involves what user expects - why the local form is the actual
   * control. Both can coexist but fulfill different purposes.
   */
  state = computed(() => {
    const config = this.mEditableOverlayControl();
    const state = config?.localForm?.() ?? this.#control?.state();

    if (!state) {
      throw new Error('Please Provide FormField to properly control editable wrapper');
    }

    return state;
  });

  /** Writable show signal (the actual signal instance) */
  showSignal = computed(() => this.mEditableOverlayControl().showSignal);
  currentValue = computed(() => this.state().value());

  /** Boolean open value */
  isOpen = computed(() => this.showSignal()());

  /**
   * Whether the control is empty
   */
  isEmpty = computed(() => {
    const state = this.state();
    if (!state) return false; // ← safe default

    if (typeof this.state().value() === 'string') {
      return this.state().value() === '';
    }

    return this.state().value() === null || this.state().value() === undefined;
  });

  /*
   * Whether the value is required
   */
  required = computed(() => !!this.state().required());

  /**
   * The value to copy
   */
  copyValue = signal<T | undefined>(undefined);

  /**
   * The warning message to display
   */
  warningMessage = linkedSignal({
    source: () => this.#control?.state().value() ?? undefined,
    computation: () => 'You have unsaved changes',
  });

  resetWarningMessage() {
    this.warningMessage.set('You have unsaved changes');
  }

  /**
   * Handler for the blur event.
   * @param event - The focus event
   */
  onBlur(event: FocusEvent) {
    if (this.state().dirty()) return;

    // 2. Check where the focus is going (relatedTarget)
    const nextTarget = event.relatedTarget as HTMLElement | null;

    // If focus is moving into the editable panel (e.g., the Save button),
    if (nextTarget?.closest('.editable-panel')) return;

    // 3. Otherwise, safe to close
    this.showSignal().set(false);
  }

  copyCurrent() {
    const value = this.copyValue() ?? this.currentValue();
    if (!value) return;
    navigator.clipboard.writeText(String(value));
  }
}
