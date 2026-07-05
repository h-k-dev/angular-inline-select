import { Directive, TemplateRef, inject } from '@angular/core';

/**
 * Suffix template for an inline field — the matSuffix analogue.
 *
 * Declared on an `ng-template` (not an element) because the affix renders
 * TWICE: after the in-flow display while idle, and beside the editor inside
 * the elevated panel while editing — the panel covers the surrounding copy,
 * so a unit written next to the field would vanish exactly while the user
 * edits. A template stamps into both places; projected elements cannot.
 *
 * The affix is never part of the draft: it sits outside the contenteditable,
 * the caret cannot enter it and the parser never sees it. It renders
 * `aria-hidden` — put the unit in `ariaLabel` ("Price in euros") where
 * assistive tech actually hears it.
 *
 * ```html
 * <angular-inline-number [(value)]="price" ariaLabel="Price in euros">
 *   <ng-template editableSuffix><mat-icon inline>euro</mat-icon></ng-template>
 * </angular-inline-number>
 * ```
 */
@Directive({
  selector: 'ng-template[editableSuffix]',
})
export class EditableSuffix {
  readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
}

/** Prefix template for an inline field — the matPrefix analogue. See {@link EditableSuffix}. */
@Directive({
  selector: 'ng-template[editablePrefix]',
})
export class EditablePrefix {
  readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
}
