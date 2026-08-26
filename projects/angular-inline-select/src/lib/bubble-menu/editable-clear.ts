import { Component, Directive, TemplateRef, inject, output } from '@angular/core';

import type { BubbleMenuSide } from './bubble-menu';

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

/**
 * Template context for {@link EditableClearTemplate} — everything a custom
 * clear affordance needs, and nothing about how the control clears.
 */
export interface EditableClearContext {
  /**
   * Perform the clear — the control's own clear path (commit + `touch` +
   * `saved`), unchanged. Call it WHEN you decide, which is the whole point:
   * an async confirmation runs BEFORE the value is touched, so a cancelled
   * gesture never reaches the bound field (and never round-trips to a
   * backend as a write-then-undo).
   */
  $implicit: () => void;
  /** The same callback, named — for a readable `let-clear="clear"`. */
  clear: () => void;
  /**
   * Which side of a range pair this affordance clears (`'start'` / `'end'`),
   * or `null` on a single-value field. Range controls stamp the template once
   * per side; the callback is already bound to the right one — this is for
   * labelling and per-side confirmation copy.
   */
  side: BubbleMenuSide | null;
  /**
   * The stock accessible name for this affordance ("Clear value", "Clear
   * start date", …), already localized by the control's `Intl` where the
   * control has one. Bind it to your own button unless you have a better
   * name — the bubble is icon-only chrome, so a name is not optional.
   */
  label: string;
  /**
   * Put focus back on the field (the side this affordance clears, on a range
   * pair). The bubble is a HOVER overlay: by the time a dialog closes, the
   * pointer has left and the button that opened it no longer exists, so a
   * modal's restore-focus has nowhere to land. Call this after the dialog
   * settles — on cancel as well as on clear — and the field keeps the
   * keyboard.
   */
  focus: () => void;
}

/**
 * REPLACES the stock clear button inside the hover bubble — the consumer's
 * own affordance, on every inline variant (text, number, phone, json, date,
 * time, duration).
 *
 * The control keeps everything it already owned: WHEN the bubble may appear
 * (not required, not disabled/readonly, not empty, not editing), where it
 * anchors, and what clearing actually does. The template owns only the
 * button: its look, its label, and — through the context's `clear` callback —
 * WHEN the clear happens.
 *
 * That last part is why this exists. `clear` is a commit: it writes the empty
 * value, marks the field touched, and emits `saved` in one synchronous go.
 * A consumer that wants to CONFIRM first (a dialog, an "are you sure" for a
 * destructive field) cannot intercept a commit that already happened — so
 * the control hands the commit over instead:
 *
 * ```html
 * <angular-inline-text [(value)]="notes">
 *   <ng-template editableClear let-clear let-label="label">
 *     <button editableClear class="my-look" [attr.aria-label]="label" (clear)="confirm(clear)">
 *       ✕
 *     </button>
 *   </ng-template>
 * </angular-inline-text>
 * ```
 *
 * ```ts
 * async confirm(ctx: EditableClearContext) {
 *   const ref = this.dialog.open(ConfirmClearDialog);   // MatDialog, or any other
 *   if (await firstValueFrom(ref.afterClosed())) ctx.clear();
 *   ctx.focus();                                        // see the focus note below
 * }
 * ```
 *
 * Keep `[editableClear]` on your button ({@link EditableClear}) — it carries
 * `type="button"` and the mousedown guard. Drop `editableClearButton` and the
 * stock pill chrome goes with it; keep the `editable-action` class if you
 * want the chrome but not the label.
 *
 * Two notes for the confirm flow:
 * - Clear is an IDLE-only affordance (the bubble is hidden while editing), so
 *   opening a modal never disturbs a live session — and `clear()` stays valid
 *   after the dialog closes, however long it took.
 * - The bubble is a hover overlay: by the time a dialog closes, the pointer
 *   has left and the bubble (with your button) is gone, so a modal's
 *   restore-focus has nowhere to land. Call the context's `focus()` when the
 *   dialog settles — it needs no reference to the control, which is what lets
 *   ONE button component serve every field on a page.
 *
 * Composition channel: wrapping controls (number, phone) forward this as the
 * `clearTemplate` INPUT, since content queries don't pierce re-projection —
 * the same dual channel as the affixes.
 */
@Directive({
  selector: 'ng-template[editableClear]',
})
export class EditableClearTemplate {
  readonly templateRef = inject<TemplateRef<EditableClearContext>>(TemplateRef);
}
