import {
  Component,
  ChangeDetectionStrategy,
  inject,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';

// Components
import { AngularInlineText } from '../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';
import { Login } from './login/login';

/**
 * The shell: sticky toolbar (editable title, page navigation, theme, login)
 * around a router outlet. The playgrounds live in lazy pages.
 */
@Component({
  selector: '[app-root]',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
  imports: [
    // Router
    RouterOutlet,
    RouterLink,
    RouterLinkActive,

    // Material
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,

    // Components
    AngularInlineText,
  ],
  host: {
    '[class]': 'themeClass()',
  },
})
export class App {
  #document = inject(DOCUMENT);
  #dialog = inject(MatDialog);

  /**
   * The toolbar title. Editable in place — and set by the login dialog.
   */
  protected readonly title = signal('Inline Text Playground');

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  protected openLoginDialog() {
    const ref = this.#dialog.open(Login, {
      width: 'min(60ch, 100dvw)',
      height: 'min(60dvh, 100dvw)',
    });

    ref.afterClosed().subscribe((displayName?: string) => {
      if (displayName) this.title.set(displayName);
    });
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------
  theme = signal<'light' | 'dark'>('light');
  themeClass = computed(() => `${this.theme()}-mode`);

  toggleTheme() {
    if (this.#document.startViewTransition) {
      this.#document.startViewTransition(() => {
        this.theme.update((theme) => (theme === 'light' ? 'dark' : 'light'));
      });

      return;
    }

    this.theme.update((theme) => (theme === 'light' ? 'dark' : 'light'));
  }
}
