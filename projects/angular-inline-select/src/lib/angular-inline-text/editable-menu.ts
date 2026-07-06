import { Directive, TemplateRef, Signal, inject } from '@angular/core';

/** Template context for {@link EditableMenu}. */
export interface EditableMenuContext {
  /** The query: the text between the trigger `/` and the end of the draft. */
  $implicit: string;
  /**
   * Id of the active option, mirrored to the editor's `aria-activedescendant`.
   * Bind `[attr.data-active]="option.id === activeId()"` for the keyboard
   * highlight — the control drives navigation, the template reflects it.
   */
  activeId: Signal<string | undefined>;
  /**
   * Apply a command: replaces the whole draft by default (a command usually
   * IS the new beginning — e.g. a country becoming `'+49 '`), or just the
   * `/query` token with `{ replaceToken: true }`. Restores the caret and
   * closes the menu.
   */
  apply: (replacement: string, options?: { replaceToken?: boolean }) => void;
}

/**
 * Slash-command menu template — typed, keyboard-first, rendered INSIDE the
 * elevated panel between the editor line and the footer. The control decides
 * WHERE/WHEN (trigger detection, keyboard routing, two-stage Escape); the
 * consumer decides WHAT: this template receives the live query and renders
 * the options — typically an `@angular/aria` listbox it filters itself.
 *
 * Focus never leaves the editor: arrow keys are forwarded to the projected
 * `[role="listbox"]`, whose `aria-activedescendant` is mirrored back onto
 * the editor (combobox pattern).
 *
 * ```html
 * <angular-inline-text [(value)]="value">
 *   <ng-template editableMenu let-query let-apply="apply">
 *     <div ngListbox focusMode="activedescendant" selectionMode="explicit" …>
 *       @for (option of filter(query); track option.id) {
 *         <div ngOption [value]="option.id">{{ option.label }}</div>
 *       }
 *     </div>
 *   </ng-template>
 * </angular-inline-text>
 * ```
 *
 * Dormant unless provided: fields without a menu template render nothing,
 * listen to nothing, and keep plain-textbox ARIA.
 */
@Directive({
  selector: 'ng-template[editableMenu]',
})
export class EditableMenu {
  readonly templateRef = inject<TemplateRef<EditableMenuContext>>(TemplateRef);
}

/** A detected slash-command token: the `/` and the query up to the caret. */
export interface SlashToken {
  /** Index of the `/` in the draft. */
  start: number;
  /** Caret index (exclusive end of the query). */
  end: number;
  /** The query text between `/` and the caret. */
  query: string;
}

/**
 * Finds the active `/query` token ending at `caret`: a `/` at the start of the
 * draft or after whitespace, with no whitespace between it and the caret.
 * Returns `null` when the caret is not inside such a token — keeping the
 * trigger from firing on mid-word slashes like `either/or` or URLs.
 */
export function detectSlashToken(text: string, caret: number): SlashToken | null {
  for (let i = caret - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '/') {
      const before = i === 0 ? '' : text[i - 1];
      if (before === '' || /\s/.test(before)) {
        return { start: i, end: caret, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(char)) return null;
  }
  return null;
}
