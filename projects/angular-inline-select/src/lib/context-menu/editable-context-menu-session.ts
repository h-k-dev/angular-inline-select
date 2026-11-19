// Angular
import { InjectionToken } from '@angular/core';

/** What one field asks the menu to offer. The field decides WHETHER to ask. */
export interface EditableContextMenuRequest {
  /** The field's box: a menu opened from the keyboard hangs under it. */
  anchor: HTMLElement;
  /** Opens the field's edit session. */
  edit: () => void;
  /** The field's own clear path — commit, `touch` and `saved`, unchanged. */
  clear: () => void;
  /** The clear row's text when "Clear" alone does not say enough (a range side). */
  clearLabel?: string;
}

/** The open menu, as its panel sees it. */
export interface EditableContextMenuSession {
  readonly request: EditableContextMenuRequest;
  /** The menu was opened without a pointer: its first row starts active. */
  readonly byKeyboard: boolean;
  /** Closes the menu, then runs the row's action (none on a dismissal). */
  close(action?: () => void): void;
}

export const EDITABLE_CONTEXT_MENU_SESSION = new InjectionToken<EditableContextMenuSession>(
  'EDITABLE_CONTEXT_MENU_SESSION',
);
