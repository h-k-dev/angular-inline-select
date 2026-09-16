import {
  Directive,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * The attribute inline controls look UP for (`closest()`): the scope is found
 * by DOM, never by injection — a cell inside a mat-table column definition
 * cannot inject a directive sitting on its row, a DOM lookup finds it.
 */
export const EDITABLE_HOVER_SCOPE_ATTRIBUTE = 'editableHoverScope';

/**
 * The press-forwarding channel, scope → field: a press on the scope's own
 * space, handed to the one field inside as the point it happened at, so the
 * field lands its caret on the nearest character exactly as it does for a
 * press in its own halo.
 */
export const EDITABLE_HOVER_SCOPE_PRESS_EVENT = 'editableScopePress';

export interface EditableHoverScopePress {
  clientX: number;
  clientY: number;
}

/** Whether an element carries its own (non-whitespace) text — a label, a value, a caption. */
function bearsText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

/**
 * The class every INTERACTIVE UNIT wears — the text family's field box, the
 * temporal family's input wrapper. It is what a scope counts and forwards
 * presses to; a control that carries it must listen for
 * `EDITABLE_HOVER_SCOPE_PRESS_EVENT`.
 */
export const EDITABLE_UNIT_CLASS = 'editable-unit';

const FIELD_SELECTOR = `.${EDITABLE_UNIT_CLASS}`;
const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [contenteditable]';

/**
 * The CONTAINER as the interactive unit — a row, a card, a cell owns the
 * hover, and the inline controls inside arm their action bubbles on it.
 *
 * The practice it follows: Gmail rows, Notion property rows, Slack messages,
 * Figma's properties panel — the container is hovered, the actions inside
 * appear, and the container PAINTS its hover (a soft surface behind the
 * content, the YouTube lockup shape). Nobody detects hover on the action's
 * own anchor and enlarges it.
 *
 * Two jobs, nothing else:
 *
 * 1. MARKER. Controls beneath find the scope element by DOM ancestor and
 *    listen to ITS mouseenter/mouseleave/focusin/focusout themselves — no
 *    injection, no registry, no instance handshake, so it survives the
 *    mat-table column-definition DI wall. A scope holding several fields
 *    arms ALL of them; if that is loud, the scope is the cell, not the row.
 * 2. PAINT. `.editable-hover-scope--active` while HOVERED — and only then.
 *    Focus-within still ARMS the actions (the field listens for it on the
 *    scope element itself) but never paints: the focused field already
 *    carries its own signal, the solid underline, and a surface that painted
 *    on focus too would paint TWO rows for the commonest gesture there is —
 *    click into one row, move the pointer to the next — with the two shapes
 *    doubling their tint where they overlap (Notion paints the hovered
 *    property row, never the focused one). The stock stylesheet draws the
 *    shape (`_editable-hover-scope.scss`).
 *
 * `pressToFocus` (default on): a press on the scope's own SPACE — not on
 * the field, not on chrome, not on text — focuses the one field inside with
 * the caret on the nearest character, so the row's shape is also the row's
 * press target and the next keystroke elevates (the Airtable cell feel).
 * "Space" is the rule that keeps labels safe: an element that carries its
 * own text (a label, a caption, a neighbouring cell's value) keeps its
 * press — a press on a label is a rename gesture in users' heads (Notion),
 * and its text stays selectable. Only when the scope holds exactly one
 * field. `[pressToFocus]="false"` opts out.
 */
@Directive({
  selector: '[editableHoverScope]',
  host: {
    class: 'editable-hover-scope',
    '[class.editable-hover-scope--active]': 'active()',
    '(mouseenter)': 'hovered.set(true)',
    '(mouseleave)': 'hovered.set(false)',
    '(mousedown)': 'handleMouseDown($event)',
  },
})
export class EditableHoverScope {
  /** Forward a press on the scope's own space to its single field (see above). */
  pressToFocus = input(true, { transform: booleanAttribute });

  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected hovered = signal(false);

  /** Painting: the pointer is over the scope. Focus never paints (see above). */
  active = computed(() => this.hovered());

  protected handleMouseDown(event: MouseEvent) {
    if (!this.pressToFocus() || event.button !== 0 || event.shiftKey) return;

    const target = event.target as Element | null;
    if (target === null) return;
    // The field owns presses on itself; chrome owns its own; text keeps its
    // press (and its selection) — only the scope's SPACE forwards.
    if (target.closest(`${FIELD_SELECTOR}, ${INTERACTIVE_SELECTOR}`) !== null) return;
    if (bearsText(target)) return;

    const fields = this.#host.nativeElement.querySelectorAll(FIELD_SELECTOR);
    if (fields.length !== 1) return;

    event.preventDefault();
    fields[0].dispatchEvent(
      new CustomEvent<EditableHoverScopePress>(EDITABLE_HOVER_SCOPE_PRESS_EVENT, {
        detail: { clientX: event.clientX, clientY: event.clientY },
      }),
    );
  }
}

/** What `observeHoverScope` hands back: the scope found (or null) and the way to stop listening. */
export interface HoverScopeWatch {
  scope: HTMLElement | null;
  disconnect(): void;
}

/**
 * The control's half of the scope contract: find the nearest
 * `[editableHoverScope]` ancestor by DOM — never by injection — and listen
 * to the scope element ITSELF, the way the bubble listens to the field.
 * `onChange(true)` on the scope's mouseenter or focus-within, `false` on
 * mouseleave or when focus leaves the scope. Without an ancestor scope the
 * watch is inert and `scope` is null — today's behaviour exactly.
 */
export function observeHoverScope(
  host: HTMLElement,
  onChange: (hover: boolean) => void,
): HoverScopeWatch {
  const scope = host.closest<HTMLElement>(`[${EDITABLE_HOVER_SCOPE_ATTRIBUTE}]`);
  if (scope === null) return { scope: null, disconnect: () => undefined };

  const enter = () => onChange(true);
  const leave = () => onChange(false);
  const focusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next === null || !scope.contains(next)) onChange(false);
  };

  scope.addEventListener('mouseenter', enter);
  scope.addEventListener('mouseleave', leave);
  scope.addEventListener('focusin', enter);
  scope.addEventListener('focusout', focusOut);

  return {
    scope,
    disconnect: () => {
      scope.removeEventListener('mouseenter', enter);
      scope.removeEventListener('mouseleave', leave);
      scope.removeEventListener('focusin', enter);
      scope.removeEventListener('focusout', focusOut);
    },
  };
}
