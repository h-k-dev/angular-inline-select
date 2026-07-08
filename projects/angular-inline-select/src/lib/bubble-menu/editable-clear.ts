import { Component, Directive, output } from '@angular/core';

/**
 * The clear-button BEHAVIOR, detached from any styling — drop it on your own
 * `<button>` to get a working clear affordance and style it however you like.
 *
 * It handles the two easy-to-forget mechanics that make a clear button behave
 * correctly INSIDE a hover bubble:
 * - `type="button"` — never submits an enclosing form;
 * - a `mousedown` guard that `preventDefault`s so the click never blurs the
 *   field mid-session (a blur would settle/close the edit session before the
 *   click lands).
 *
 * It emits `clear` on click; the host control wires the actual clearing (each
 * control clears differently), so this stays behavior-only, value-agnostic.
 *
 * ```html
 * <button editableClear (clear)="clearValue($event)" class="my-own-look">✕</button>
 * ```
 */
@Directive({
  selector: 'button[editableClear]',
  host: {
    type: 'button',
    '(mousedown)': 'onMousedown($event)',
    '(click)': 'onClick($event)',
  },
})
export class EditableClear {
  /** Fired on click, after the focus-preserving mousedown guard. */
  clear = output<Event>();

  onMousedown(event: Event) {
    // Keep focus on the field: a blur would settle/close the edit session.
    event.preventDefault();
    event.stopPropagation();
  }

  onClick(event: Event) {
    this.clear.emit(event);
  }
}

/**
 * The DEFAULT clear button — {@link EditableClear}'s behavior (composed as a
 * host directive, so its `clear` output is exposed here) plus the shared pill
 * chrome (`editable-action editable-action-clear`, global in
 * styles/_editable.scss) and a "clear" label. Use it for the stock look; reach
 * for the bare `[editableClear]` directive when you want your own button.
 *
 * ```html
 * <button editableClearButton aria-label="Clear value" (clear)="clearValue($event)"></button>
 * ```
 */
@Component({
  selector: 'button[editableClearButton]',
  hostDirectives: [{ directive: EditableClear, outputs: ['clear'] }],
  host: { class: 'editable-action editable-action-clear' },
  template: 'clear',
})
export class EditableClearButton {}
