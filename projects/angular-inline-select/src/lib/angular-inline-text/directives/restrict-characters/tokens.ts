import { InjectionToken } from '@angular/core';

export interface RestrictStrategy {
  /**
   * Optional identifier (for debugging / logging).
   * Not required for execution.
   */
  readonly strategy?: string;

  beforeInput?(ctx: RestrictContext, e: InputEvent): void;
  paste?(ctx: RestrictContext, e: ClipboardEvent): void;
  keydown?(ctx: RestrictContext, e: KeyboardEvent): void;
}

export interface RestrictContext {
  el: HTMLInputElement | HTMLTextAreaElement;
  setValueAndNotify(value: string): void;
  proposedAfterInsert(insert: string): string;
  insertTextAtSelection?(text: string): void;
}

/**
 * Explicit "do nothing" strategy.
 *
 * This is a single frozen object shared by the whole app.
 * It is NOT provided via DI and has zero runtime behavior.
 */
export const NOOP_STRATEGY: RestrictStrategy = Object.freeze({
  strategy: 'noop',
});

/**
 * Optional: only needed if you still want to register strategies via DI.
 * Can be removed if you always pass `[strategy]="..."` directly.
 */
export const RESTRICT_STRATEGIES = new InjectionToken<RestrictStrategy[]>('RESTRICT_STRATEGIES');
