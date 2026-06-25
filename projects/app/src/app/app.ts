import {
  Component,
  ChangeDetectionStrategy,
  inject,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

// Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';

// Components
import { AngularInlineText } from '../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';
import { Login } from './login/login';

export interface DemoRow {
  position: number;
  name: string;
  notes: string;
}

const SAMPLE_NAMES = [
  'Aurora',
  'Borealis',
  'Cascade',
  'Drift',
  'Ember',
  'Flux',
  'Gossamer',
  'Halo',
  'Iris',
  'Junction',
];

@Component({
  selector: '[app-root]',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
  imports: [
    // Material
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,

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
  // Paragraph example
  // ---------------------------------------------------------------------------
  protected projectName = signal('Aurora');
  protected summary = signal(
    'Click any highlighted text on this page and start typing. ' +
      'Save with Ctrl+Enter or the Save button, discard with Escape — ' +
      'the overlay only appears once you actually change something.',
  );

  // ---------------------------------------------------------------------------
  // Table example (100 rows)
  // ---------------------------------------------------------------------------
  protected displayedColumns = ['position', 'name', 'notes'];

  protected rows: DemoRow[] = Array.from({ length: 100 }, (_, i) => ({
    position: i + 1,
    name: `${SAMPLE_NAMES[i % SAMPLE_NAMES.length]} ${i + 1}`,
    notes: `Editable notes for row ${i + 1}`,
  }));

  // ---------------------------------------------------------------------------
  // Layout shift tester
  // ---------------------------------------------------------------------------
  // Pushes the whole content area aside with a left margin to stress-test the
  // ResizeObserver in OverlayWidthSyncDirective: the editable wrapper resizes,
  // the overlay has to re-measure and reposition while open.
  protected pushMargin = signal(0);
  protected oscillate = signal(false);

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  protected openLoginDialog() {
    const ref = this.#dialog.open(Login, {
      width: 'min(60ch, 100dvw)',
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
