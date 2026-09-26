// Angular
import { Directive, inject, TemplateRef } from '@angular/core';

/**
 * TEMPLATE variant of `EditableError` — for controls whose session UI renders
 * in a PORTALED component (the JSON control's modal dialog) where
 * `<ng-content>` projection cannot reach. Same ownership split: the consumer
 * decides what the error says, the control decides when it shows. Lives with
 * the JSON control, its only user.
 *
 * ```html
 * <angular-inline-json [formField]="form.metadata">
 *   <ng-template editableError>Metadata is required.</ng-template>
 * </angular-inline-json>
 * ```
 */
@Directive({
  selector: 'ng-template[editableError]',
})
export class EditableErrorTemplate {
  readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
}
