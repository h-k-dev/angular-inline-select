// Angular
import {
  Component,
  Directive,
  inject,
  InjectionToken,
  type Provider,
  type Type,

  // Signals
  output,
} from '@angular/core';

// Editables
import type { BubbleMenuSide } from './bubble-menu';

/**
 * The clear-button BEHAVIOR, detached from any styling — drop it on your own
 * `<button>` to get a working clear affordance and style it however you like.
 *
 * It handles the two easy-to-forget mechanics that make a clear button behave
 * correctly beside a field:
 * - `type="button"` — never submits an enclosing form;
 * - a `mousedown` guard that `preventDefault`s so the press never moves focus
 *   (a focus on the field would open its session before the click lands).
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
    // Attributes
    type: 'button',

    // Listeners
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

/** What a clear-button renderer is handed — see {@link EDITABLE_CLEAR_BUTTON}. */
export interface EditableClearButtonContext {
  /** The control's own clear path — commit, `touch` and `saved`. */
  clear(): void;
  /** The accessible name ("Clear date", "Clear start date"), localized by the control. */
  label(): string;
  /** Which side of a range pair this button clears, or `null` on a single-value field. */
  readonly side: BubbleMenuSide | null;
}

/** Injected by a clear-button renderer (the component slot). */
export const EDITABLE_CLEAR_BUTTON_CONTEXT = new InjectionToken<EditableClearButtonContext>(
  'EDITABLE_CLEAR_BUTTON_CONTEXT',
);

/**
 * The stock renderer: a native button on the global `.editable-clear-button`
 * chrome (styles/_editable.scss) — {@link EditableClear}'s behavior and a ×.
 */
@Component({
  selector: 'editable-clear-button',
  imports: [
    // Directives
    EditableClear,
  ],
  template: `
    <button
      editableClear
      class="editable-clear-button"
      tabindex="-1"
      [attr.aria-label]="context.label()"
      (clear)="context.clear()"
    >
      ×
    </button>
  `,
  host: {
    // Styles
    style: 'display: contents',
  },
})
export class EditableClearButtonDefault {
  protected readonly context = inject(EDITABLE_CLEAR_BUTTON_CONTEXT);
}

/**
 * The component a control renders its IN-FIELD clear button with — the date
 * field keeps a small button beside each value. Every other editable clears
 * from the context menu (`EditableContextMenu`).
 */
export const EDITABLE_CLEAR_BUTTON = new InjectionToken<Type<unknown>>('EDITABLE_CLEAR_BUTTON', {
  providedIn: 'root',
  factory: () => EditableClearButtonDefault,
});

/**
 * Swaps the in-field clear button for every control under this injector. The
 * component injects `EDITABLE_CLEAR_BUTTON_CONTEXT` and keeps `[editableClear]`
 * on its button:
 *
 *     providers: [provideEditableClearButton(MyClearButton)]
 */
export function provideEditableClearButton(component: Type<unknown>): Provider {
  return { provide: EDITABLE_CLEAR_BUTTON, useValue: component };
}
