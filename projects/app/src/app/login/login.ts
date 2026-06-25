import { Component, signal } from '@angular/core';

import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

// Components
import { AngularInlineText } from '../../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';

@Component({
  selector: 'app-login',
  imports: [
    // Material
    MatDialogModule,
    MatButtonModule,

    // Components
    AngularInlineText,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  /**
   * The display name entered by the user. On "Sign In" this is returned
   * as the dialog result and becomes the app's toolbar title.
   */
  displayName = signal('');
}
