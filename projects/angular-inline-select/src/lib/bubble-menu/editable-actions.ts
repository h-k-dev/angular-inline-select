import { Directive, TemplateRef, inject } from '@angular/core';

import type { BubbleMenuSide } from './bubble-menu';

/**
 * Template context for {@link EditableActionsTemplate} — the DATA a control
 * exposes about its value, typed per control, and nothing about how to act
 * on it. The consumer's template reads it (`let-data`) and renders whatever
 * buttons its house wants: an anchor that opens a link, a call button that
 * talks to its own dialer service, three buttons, none.
 */
export interface EditableActionsContext<T> {
  /** The control's payload — `let-data` (or the bare `let-` implicit). */
  $implicit: T;
  /** The same payload, named. */
  data: T;
  /**
   * Which side of a range pair this bubble belongs to (`'start'` / `'end'`),
   * or `null` on a single-value field. Range controls stamp the template once
   * per side, each with that side's payload.
   */
  side: BubbleMenuSide | null;
  /**
   * Put focus back on the field. The bubble is a HOVER overlay: by the time a
   * dialog the action opened closes, the pointer has left and the button that
   * opened it no longer exists. Call this when the dialog settles.
   */
  focus: () => void;
}

/**
 * The PRIMARY-ACTIONS slot of the hover bubble — consumer-owned buttons that
 * act ON the value (open the link, call the number, copy the address), stamped
 * BEFORE the clear affordance, separated from it.
 *
 * The seam mirrors `editableClear`, with one inversion: the control never
 * renders an action itself. It has no idea what a house does with a phone
 * number; it hands over the DATA (typed per control — see each control's
 * `*Actions` payload type) and the consumer renders the buttons. Several
 * buttons in one template is just several buttons.
 *
 * ```html
 * <angular-inline-phone [(value)]="phone">
 *   <ng-template editableActions let-data>
 *     <a editableAction class="editable-action" [href]="data.tel" aria-label="Call">📞</a>
 *   </ng-template>
 * </angular-inline-phone>
 * ```
 *
 * GATES ARE PER SLOT. Clear keeps its policy (never on required / disabled /
 * readonly / empty / editing, plus `showClear`). Actions show whenever the
 * template exists and the value is actionable — non-empty, not mid-edit —
 * and DELIBERATELY ignore required, disabled and readonly: a readonly phone
 * still wants its call button, a required link still wants open. The bubble
 * appears when either slot has something.
 *
 * Composition channel: wrapping controls (number, phone) forward this as the
 * `actionsTemplate` INPUT together with their own typed payload
 * (`actionsData`), since content queries don't pierce re-projection — the
 * same dual channel as the affixes and the clear seam.
 */
@Directive({
  selector: 'ng-template[editableActions]',
})
export class EditableActionsTemplate<T = unknown> {
  readonly templateRef = inject<TemplateRef<EditableActionsContext<T>>>(TemplateRef);
}

/**
 * The action-button BEHAVIOR, detached from styling — drop it on the
 * consumer's `<button>` or `<a>` inside an `editableActions` template. It
 * guards `mousedown` so the press never moves focus off the field (a blur
 * would settle a session; a press on the bubble must also never reach a
 * hover scope's press forwarding). Navigation and click handlers are
 * untouched — an anchor still opens its `href`.
 */
@Directive({
  selector: '[editableAction]',
  host: {
    '(mousedown)': 'onMousedown($event)',
  },
})
export class EditableAction {
  onMousedown(event: Event) {
    event.preventDefault();
    event.stopPropagation();
  }
}
