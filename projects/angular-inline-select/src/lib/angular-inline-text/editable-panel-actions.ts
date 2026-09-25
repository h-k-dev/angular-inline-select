import {
  Component,
  Directive,
  InjectionToken,
  TemplateRef,
  inject,
  type Provider,
  type Signal,
  type Type,
} from '@angular/core';

import { EditableTextIntl } from './editable-text-intl';

// =============================================================================
// Panel actions — the Save / Discard slot of the elevated text panel
//
// The control OWNS the slot and ships native buttons as the default; a host
// swaps the renderer once, app-wide, through DI (the `MAT_*_DEFAULT_OPTIONS`
// idiom), or per field through `ng-template[editablePanelActions]`.
//
// The contract a renderer relies on — the control keeps all of it, so no
// customization can break it:
// - KEYS are the panel's. Escape (revert), Ctrl+Enter (save) and Tab (scope
//   handover) are handled on the panel element; a renderer must let keydown
//   bubble to it. A button that swallows keydown strands the user on it.
// - FOCUS stays in the editor. The control wraps the slot in a container that
//   prevents the pointer's mousedown, so pressing any action keeps the caret
//   and the session alive — a renderer needs no per-button preventDefault.
// - The VERBS are the context's: `accept()` saves (and, while invalid, is the
//   save attempt that reveals the errors — mat submit semantics), `cancel()`
//   reverts and closes.
// =============================================================================

/** What a panel-actions renderer gets: the session's two verbs and its state. */
export interface EditablePanelActionsContext {
  /** Saves the session; while invalid, the save attempt that reveals the errors. */
  accept(): void;
  /** Reverts the draft to the session baseline and closes the panel. */
  cancel(): void;
  /** Whether the draft differs from the committed value. */
  readonly dirty: Signal<boolean>;
  /** Whether the draft fails validation. */
  readonly invalid: Signal<boolean>;
}

/** Injected by a DI-provided renderer (the component slot). */
export const EDITABLE_PANEL_ACTIONS_CONTEXT = new InjectionToken<EditablePanelActionsContext>(
  'EDITABLE_PANEL_ACTIONS_CONTEXT',
);

/**
 * The stock renderer: two native buttons on the global `.editable-action*`
 * chrome, labelled through `EditableTextIntl`.
 */
@Component({
  selector: 'editable-panel-actions',
  template: `
    <button type="button" class="editable-action editable-action-reset" (click)="context.cancel()">
      {{ intl.discardLabel() }}
    </button>
    <!-- Stays clickable while invalid: a save attempt reveals the errors (mat submit semantics) -->
    <button type="button" class="editable-action editable-action-save" (click)="context.accept()">
      {{ intl.saveLabel() }}
    </button>
  `,
  host: { style: 'display: contents' },
})
export class EditablePanelActionsDefault {
  protected readonly context = inject(EDITABLE_PANEL_ACTIONS_CONTEXT);
  protected readonly intl = inject(EditableTextIntl);
}

/** The component every text panel renders its actions with. */
export const EDITABLE_PANEL_ACTIONS = new InjectionToken<Type<unknown>>('EDITABLE_PANEL_ACTIONS', {
  providedIn: 'root',
  factory: () => EditablePanelActionsDefault,
});

/**
 * Swaps the panel-actions renderer for every text panel under this injector.
 * The component injects `EDITABLE_PANEL_ACTIONS_CONTEXT`:
 *
 *     providers: [provideEditablePanelActions(MyPanelActions)]
 */
export function provideEditablePanelActions(component: Type<unknown>): Provider {
  return { provide: EDITABLE_PANEL_ACTIONS, useValue: component };
}

/** Template context of `ng-template[editablePanelActions]`. */
export interface EditablePanelActionsTemplateContext {
  $implicit: EditablePanelActionsContext;
}

/**
 * Per-field override of the panel actions — wins over the DI renderer:
 *
 *     <ng-template editablePanelActions let-actions>
 *       <button (click)="actions.accept()">Apply</button>
 *     </ng-template>
 */
@Directive({ selector: 'ng-template[editablePanelActions]' })
export class EditablePanelActionsTemplate {
  readonly templateRef = inject<TemplateRef<EditablePanelActionsTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _dir: EditablePanelActionsTemplate,
    ctx: unknown,
  ): ctx is EditablePanelActionsTemplateContext {
    return true;
  }
}
