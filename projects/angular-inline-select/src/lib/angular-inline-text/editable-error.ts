import { Directive } from '@angular/core';

/**
 * Marker for parent-provided error content — the mat-error analogue.
 *
 * Projected into the panel's error slot and shown by the field itself under
 * mat-form-field rules (invalid AND touched-or-save-attempted) — consumers
 * decide *what* the error says, never *when* it shows. When present it takes
 * over the slot entirely; without it the field renders the message-carrying
 * errors itself.
 *
 * ```html
 * <angular-inline-text [formField]="form.callsign">
 *   <span editable-error>Callsigns look like “AUR-01”.</span>
 * </angular-inline-text>
 * ```
 *
 * The element must be a direct, unconditional child — projection matches the
 * `[editable-error]` attribute, and control-flow blocks don't match attribute
 * selectors. Gate variable content with `@if` INSIDE the element.
 */
@Directive({
  selector: '[editable-error]',
})
export class EditableError {}
