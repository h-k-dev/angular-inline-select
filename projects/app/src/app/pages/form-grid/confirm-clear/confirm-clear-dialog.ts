import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

/** What the opener passes: the field's own accessible clear label. */
export interface ConfirmClearData {
  label: string;
}

/**
 * The consumer half of the `editableClear` seam: an ordinary MatDialog.
 * Nothing here knows about inline controls, and nothing in the library knows
 * about mat — the field hands its clear callback to the page, the page
 * decides whether to call it.
 */
@Component({
  selector: 'app-confirm-clear-dialog',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.label }}?</h2>
    <mat-dialog-content>
      Clearing commits immediately — the field saves an empty value and there is no undo.
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Keep it</button>
      <button mat-flat-button class="confirm-clear-dialog__confirm" [mat-dialog-close]="true">
        Clear it
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    /* The destructive action wears the error role, like the button that opened it. */
    .confirm-clear-dialog__confirm {
      --mdc-filled-button-container-color: var(--mat-sys-error);
      --mdc-filled-button-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmClearDialog {
  protected data = inject<ConfirmClearData>(MAT_DIALOG_DATA);
}
