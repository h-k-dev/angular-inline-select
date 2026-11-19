// Angular
import { InjectionToken, type Provider } from '@angular/core';

/** App-wide switches of the editables' context menu — see {@link provideEditableContextMenu}. */
export interface EditableContextMenuConfig {
  /**
   * Whether a right-click on an editable opens the menu. Read on every
   * gesture, so a signal-backed answer follows the viewport live. While it
   * says `false` the gesture is not touched at all: no overlay, no
   * `preventDefault`, the platform's own menu (or long-press) runs.
   */
  enabled: () => boolean;

  /**
   * The font-set class of the app's ligature icon font (Material Symbols:
   * `'material-symbols-outlined'`). Set, every row leads with its icon —
   * `edit` and `close`; unset, the rows are text only, so the menu never
   * asks for a font the app does not load.
   */
  iconFontClass?: string;
}

export const EDITABLE_CONTEXT_MENU_CONFIG = new InjectionToken<EditableContextMenuConfig>(
  'EDITABLE_CONTEXT_MENU_CONFIG',
  {
    providedIn: 'root',
    factory: () => ({ enabled: () => true }),
  },
);

/**
 * Configures the context menu for every editable under this injector. The
 * factory runs in an injection context, so the answer can come from whatever
 * the app already knows about its device:
 *
 *     provideEditableContextMenu(() => {
 *       const viewport = inject(MyViewport);
 *       return { enabled: () => !viewport.isMobile(), iconFontClass: 'material-symbols-outlined' };
 *     })
 */
export function provideEditableContextMenu(factory: () => EditableContextMenuConfig): Provider {
  return { provide: EDITABLE_CONTEXT_MENU_CONFIG, useFactory: factory };
}
