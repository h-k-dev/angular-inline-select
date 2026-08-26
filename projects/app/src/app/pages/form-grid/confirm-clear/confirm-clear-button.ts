import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { EditableClear } from '../../../../../../angular-inline-select/src/lib/bubble-menu/editable-clear';

import { ConfirmClearDialog, type ConfirmClearData } from './confirm-clear-dialog';

/**
 * ONE custom clear button for EVERY inline field on the page — the whole point
 * of the `editableClear` seam. The field hands over three context values and
 * nothing else: the `clear` callback, its own accessible `label`, and `focus`
 * to put the keyboard back. No field type, no value type, no per-field wiring
 * — which is why a single `<ng-template>` can serve a grid of text, number,
 * phone, date, time, duration and JSON fields alike.
 *
 * ```html
 * <ng-template #confirmClear let-clear let-label="label" let-focus="focus">
 *   <app-confirm-clear [clear]="clear" [label]="label" [focusField]="focus" />
 * </ng-template>
 *
 * <angular-inline-text [formField]="form.project" [clearTemplate]="confirmClear" />
 * ```
 *
 * `[editableClear]` on the button is the library's bare behavior directive:
 * `type="button"` plus the mousedown guard that keeps a click from blurring
 * the field. Everything else here — mat icon button, the error role, the
 * dialog — is ours.
 */
@Component({
  selector: 'app-confirm-clear',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatButtonModule, MatIconModule, EditableClear],
  template: `
    <button
      mat-icon-button
      editableClear
      class="confirm-clear__button"
      [attr.aria-label]="label()"
      (clear)="confirm()"
    >
      <mat-icon>backspace</mat-icon>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    /*
      The destructive role, spoken in mat system tokens: --mat-sys-error is the
      M3 equivalent of the library's own error color (the idle error underline
      resolves to the same token).
    */
    .confirm-clear__button {
      --mat-icon-button-icon-color: var(--mat-sys-error);
      --mat-icon-button-state-layer-color: var(--mat-sys-error);
      --mat-icon-button-ripple-color: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
      --mat-icon-button-icon-size: 18px;
      --mat-icon-button-touch-target-display: none;

      width: 32px;
      height: 32px;
      padding: 7px;
      color: var(--mat-sys-error);
    }
  `,
})
export class ConfirmClearButton {
  /** The field's clear path — called ONLY if the dialog comes back yes. */
  clear = input.required<() => void>();

  /** The field's own accessible name, spoken by the button and the dialog. */
  label = input.required<string>();

  /**
   * Puts focus back on the field. The bubble is a hover overlay: by the time
   * the dialog closes, this button no longer exists, so the modal's
   * restore-focus has nowhere to land.
   */
  focusField = input.required<() => void>();

  #dialog = inject(MatDialog);

  protected async confirm() {
    const data: ConfirmClearData = { label: this.label() };
    const confirmed = await firstValueFrom(
      // `restoreFocus: false` because the element the dialog would restore to
      // is THIS button, and the hover bubble took it away while the dialog was
      // open. Mat's restoration runs after `afterClosed`, so left on it would
      // simply undo the context's focus() below and drop focus on the body.
      this.#dialog.open(ConfirmClearDialog, { data, restoreFocus: false }).afterClosed(),
    );

    if (confirmed === true) this.clear()();

    // Always — a cancelled clear should leave the keyboard where it was too.
    this.focusField()();
  }
}
