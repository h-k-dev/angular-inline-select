import { Directive, TemplateRef, inject } from '@angular/core';

/**
 * Hint template for the elevated panel's footer — rendered while the session
 * is open, above the actions and independent of the error state. The home of
 * live, per-keystroke feedback that must never touch the draft itself:
 * interpretation previews (inline-phone), character counters, etc.
 *
 * Declared on an `ng-template` so wrapping controls can forward it as a
 * `TemplateRef` through the `hintTemplate` input (content queries don't
 * pierce re-projection).
 *
 * ```html
 * <angular-inline-text [(value)]="note">
 *   <ng-template editableHint>{{ note().length }}/200</ng-template>
 * </angular-inline-text>
 * ```
 */
@Directive({
  selector: 'ng-template[editableHint]',
})
export class EditableHint {
  readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
}
