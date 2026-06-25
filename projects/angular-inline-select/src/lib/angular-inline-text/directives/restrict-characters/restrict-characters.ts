import { computed, Directive, ElementRef, inject, input, signal } from '@angular/core';
import { NOOP_STRATEGY, RestrictStrategy } from './tokens';

export interface BlockedInputEvent {
  kind: 'beforeinput' | 'paste' | 'keydown';
  attempted?: string;
  strategy?: string;
}

/**
 * RestrictCharacters Directive
 * ===========================
 * Attribute directive that restricts / transforms user input based on a provided strategy instance.
 *
 * - Host element should remain a text input/textarea (no native input type switching).
 * - Strategy instance is passed in via `[strategy]`.
 * - Delegates input-related DOM events to the strategy.
 * - IME-safe: ignores `beforeinput` while composition is active.
 *
 * Usage
 * -----
 * ```html
 * <input type="text"
 *        mRestrictCharacters
 *        [strategy]="numberOnlyStrategy" />
 * ```
 */
@Directive({
  selector: '[mRestrictCharacters]',
  exportAs: 'restrictCharacters',
  host: {
    '(beforeinput)': 'onBeforeInput($event)',
    '(paste)': 'onPaste($event)',
    '(keydown)': 'onKeydown($event)',
    '(compositionstart)': 'onCompositionStart()',
    '(compositionend)': 'onCompositionEnd()',
  },
})
export class RestrictCharacters {
  strategy = input<RestrictStrategy>(NOOP_STRATEGY);

  #elRef = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);

  // Signals for directive state
  #composing = signal(false);

  // Computed: active strategy (mostly just for readability)
  #activeStrategy = computed(() => this.strategy());

  get el() {
    return this.#elRef.nativeElement;
  }

  // ctx as a method: always up-to-date, no capture issues
  #ctx() {
    const el = this.el;

    return {
      el,
      setValueAndNotify: (v: string) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      proposedAfterInsert: (insert: string) => {
        const { value, selectionStart, selectionEnd } = el;
        const s = selectionStart ?? value.length;
        const e = selectionEnd ?? value.length;
        return value.slice(0, s) + insert + value.slice(e);
      },
      insertTextAtSelection: (text: string) => {
        const { value, selectionStart, selectionEnd } = el;
        const s = selectionStart ?? value.length;
        const e = selectionEnd ?? value.length;

        const next = value.slice(0, s) + text + value.slice(e);

        el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));

        const pos = s + text.length;
        el.setSelectionRange(pos, pos);
      },
    };
  }

  onCompositionStart() {
    this.#composing.set(true);
  }

  onCompositionEnd() {
    this.#composing.set(false);
  }

  onBeforeInput(e: InputEvent) {
    if (this.#composing()) return;
    this.#activeStrategy()?.beforeInput?.(this.#ctx(), e);
  }

  onPaste(e: ClipboardEvent) {
    this.#activeStrategy()?.paste?.(this.#ctx(), e);
  }

  onKeydown(e: KeyboardEvent) {
    this.#activeStrategy()?.keydown?.(this.#ctx(), e);
  }
}
