import {
  Component,
  ChangeDetectionStrategy,
  inject,

  // Signals
  signal,
  computed,
  linkedSignal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

// CDK
import { BreakpointObserver } from '@angular/cdk/layout';

// Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';

// Components
import { AngularInlineText } from '../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';
import { PAGES } from './docs/docs-data';

/**
 * The shell: sticky toolbar (editable title, section documentation nav,
 * theme, login) over a sidenav layout. The left sidenav lists the playground
 * pages (over + backdrop ≤1024px, side-by-side above); the toolbar nav is
 * contextual to the active section: Playground | API | Theming.
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
    MatSidenavModule,
    MatListModule,
    MatTabsModule,

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
  #router = inject(Router);

  /**
   * The toolbar title. Editable in place — and set by the login dialog.
   */
  protected readonly title = signal('Inline Text Playground');

  // ---------------------------------------------------------------------------
  // Sidenav: playground pages
  // ---------------------------------------------------------------------------
  /** The sidenav items — sourced from the docs registry, one entry per playground. */
  protected readonly pages = PAGES;

  /** Narrow viewport (<1024px): the sidenav overlays instead of pushing. */
  #isNarrow = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 1023.98px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  protected sidenavMode = computed(() => (this.#isNarrow() ? 'over' : 'side'));

  /** Follows the breakpoint (open on wide, closed on narrow) until the user toggles. */
  protected sidenavOpened = linkedSignal(() => !this.#isNarrow());

  protected toggleSidenav() {
    this.sidenavOpened.update((open) => !open);
  }

  /** In over mode a navigation should dismiss the drawer; in side mode it stays. */
  protected handleSidenavNavigation() {
    if (this.#isNarrow()) this.sidenavOpened.set(false);
  }

  // ---------------------------------------------------------------------------
  // Contextual documentation nav: Playground | API | Theming for the section
  // ---------------------------------------------------------------------------
  #url = toSignal(
    this.#router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.#router.url },
  );

  /** The active section — the first URL segment ('text', 'number', …). */
  protected section = computed(() => {
    const [segment] = this.#url().split(/[?#]/)[0].split('/').filter(Boolean);
    return segment ?? 'text';
  });

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  // Lazy like the pages: the dialog carries the phone engine (metadata) and
  // the temporal trio — statically importing it would drag both into main.
  protected async openLoginDialog() {
    const { Login } = await import('./login/login');

    const ref = this.#dialog.open(Login, {
      width: 'min(60ch, 100dvw)',
      height: 'min(60dvh, 100dvh)',
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
