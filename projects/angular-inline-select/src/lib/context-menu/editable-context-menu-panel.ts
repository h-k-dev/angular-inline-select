// Angular
import {
  Component,
  ElementRef,
  inject,

  // Signals
  signal,
  viewChild,
} from '@angular/core';

// CDK
import { _IdGenerator } from '@angular/cdk/a11y';

// Editables
import { EditableTextIntl } from '../angular-inline-text/editable-text-intl';
import { EDITABLE_CONTEXT_MENU_CONFIG } from './editable-context-menu-config';
import { EDITABLE_CONTEXT_MENU_SESSION } from './editable-context-menu-session';

/**
 * The menu's panel: two rows, Edit then Clear — the one that empties the
 * field is never the row under the pointer when the menu opens, and it
 * wears the danger tone. Each row leads with an icon where the app named
 * its icon font (`iconFontClass`).
 *
 * The menu element keeps focus and the active row is told through
 * `aria-activedescendant`, so a menu opened by the pointer shows no row as
 * picked until the pointer or an arrow key reaches one. The chrome is global
 * (`.editable-context-menu*`, styles/_editable.scss).
 */
@Component({
  selector: 'editable-context-menu-panel',
  templateUrl: './editable-context-menu-panel.html',
})
export class EditableContextMenuPanel {
  #session = inject(EDITABLE_CONTEXT_MENU_SESSION);

  protected readonly intl = inject(EditableTextIntl);
  protected readonly menuId = inject(_IdGenerator).getId('editable-context-menu-');

  protected menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  /** The app's ligature icon font, when it named one. */
  protected readonly iconFontClass = inject(EDITABLE_CONTEXT_MENU_CONFIG).iconFontClass;

  protected readonly rows = [
    {
      id: 'edit',
      icon: 'edit',
      danger: false,
      label: () => this.intl.editLabel(),
      action: this.#session.request.edit,
    },
    {
      id: 'clear',
      icon: 'close',
      danger: true,
      label: () => this.#session.request.clearLabel ?? this.intl.clearLabel(),
      action: this.#session.request.clear,
    },
  ];

  /** The active row's index; -1 while none is. */
  protected active = signal(this.#session.byKeyboard ? 0 : -1);

  /** Takes the keyboard — called by the service once the panel is rendered and shown. */
  focus() {
    this.menu().nativeElement.focus({ preventScroll: true });
  }

  protected pick(index: number) {
    const row = this.rows[index];
    if (row) this.#session.close(row.action);
  }

  protected handleKeydown(event: KeyboardEvent) {
    const last = this.rows.length - 1;
    const active = this.active();

    switch (event.key) {
      case 'ArrowDown':
        this.active.set(active >= last ? 0 : active + 1);
        break;
      case 'ArrowUp':
        this.active.set(active <= 0 ? last : active - 1);
        break;
      case 'Home':
        this.active.set(0);
        break;
      case 'End':
        this.active.set(last);
        break;
      case 'Enter':
      case ' ':
        this.pick(active);
        break;
      case 'Escape':
      case 'Tab':
        this.#session.close();
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
  }
}
