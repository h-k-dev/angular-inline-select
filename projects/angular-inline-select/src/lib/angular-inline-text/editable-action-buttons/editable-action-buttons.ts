import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'm-editable-action-buttons',
  imports: [
    // Material
    MatIconModule,
    MatButtonModule,
  ],
  templateUrl: './editable-action-buttons.html',
  styleUrl: './editable-action-buttons.scss',
})
export class EditableActionButtons {
  accept = output();
  decline = output();
  disableAccept = input<boolean>(false);
  disable = input<boolean>(false);
  isLoading = input<boolean>(false);

  hideDiscard = input<boolean>(false);
}
