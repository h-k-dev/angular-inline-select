// Angular
import {
  // Signals
  afterRenderEffect,
  computed,
  signal,
  type Signal,
  untracked,
  type WritableSignal,
} from '@angular/core';

// Editables
import { getSelectionOffsets, setCaretOffset } from './caret';
import { detectSlashToken, type SlashToken } from './editable-menu';

/** Replaces the draft with a command's text — the whole draft, or only the `/query` token. */
export type SlashMenuApply = (replacement: string, options?: { replaceToken?: boolean }) => void;

/** The `editableMenu` template context: the live query, the active-option id, `apply`. */
export interface SlashMenuContext {
  $implicit: string;
  activeId: Signal<string | undefined>;
  apply: SlashMenuApply;
}

/** The text control's slash-command menu — see `makeSlashMenu`. */
export interface SlashMenu {
  readonly open: Signal<boolean>;
  readonly query: Signal<string>;
  /** Id of the active option (mirrored to the editor's `aria-activedescendant`). */
  readonly activeId: WritableSignal<string | undefined>;
  readonly context: Signal<SlashMenuContext>;
  readonly apply: SlashMenuApply;
  /** Re-detects the `/query` token from the editor DOM — after every edit. */
  detect(editor: HTMLElement): void;
  close(): void;
  /** Arrow-key navigation over the options, wrapping. */
  move(delta: number): void;
  /** Enter on an open menu: clicks the active option. Returns whether it claimed the key. */
  selectActive(event: Event): boolean;
}

/**
 * The slash-command menu, dormant unless a template is provided. The consumer
 * owns the options and the search (an `@for` filtered by the live query); this
 * owns the trigger, keyboard navigation and the combobox's active option.
 * Call in an injection context: the active option follows the consumer's
 * re-filtering after every render.
 */
export function makeSlashMenu(options: {
  template: () => unknown;
  container: () => HTMLElement | undefined;
  editor: () => HTMLElement | undefined;
  /** The editor pass to run once a command rewrote the draft. */
  afterApply: () => void;
}): SlashMenu {
  const token = signal<SlashToken | null>(null);
  const activeId = signal<string | undefined>(undefined);
  const open = computed(() => options.template() != null && token() != null);
  const query = computed(() => token()?.query ?? '');

  /** The projected option elements, in DOM order. */
  const optionElements = (): HTMLElement[] => {
    const container = options.container();
    return container ? Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')) : [];
  };

  const close = () => {
    token.set(null);
    activeId.set(undefined);
  };

  // Keeps the active option valid as the consumer re-filters: when the menu
  // opens or the query changes, land on the first option (or clear if none).
  afterRenderEffect(() => {
    if (!token()) return;

    const elements = optionElements();
    const active = untracked(activeId);
    if (elements.length === 0) {
      if (active !== undefined) activeId.set(undefined);
    } else if (active === undefined || !elements.some((element) => element.id === active)) {
      activeId.set(elements[0].id);
    }
  });

  // An arrow, so the template context can hold it. Replaces the whole draft
  // by default (a command is usually the new beginning — a country becoming
  // `'+49 '`), or just the `/query` token with `{ replaceToken: true }`.
  const apply: SlashMenuApply = (replacement, applyOptions) => {
    const editor = options.editor();
    if (!editor) return;

    const target = applyOptions?.replaceToken ? token() : null;
    const text = editor.innerText ?? editor.textContent ?? '';

    editor.textContent = target
      ? text.slice(0, target.start) + replacement + text.slice(target.end)
      : replacement;
    setCaretOffset(editor, (target?.start ?? 0) + replacement.length);
    close();
    options.afterApply();
  };

  return {
    open,
    query,
    activeId,
    context: computed(() => ({ $implicit: query(), activeId, apply })),
    apply,

    detect(editor) {
      if (!options.template()) return;

      const selection = getSelectionOffsets(editor);
      const text = editor.innerText ?? editor.textContent ?? '';
      token.set(detectSlashToken(text, selection?.end ?? text.length));
    },

    close,

    move(delta) {
      const elements = optionElements();
      if (elements.length === 0) return;

      const index = elements.findIndex((element) => element.id === activeId());
      const next =
        index < 0
          ? delta > 0
            ? 0
            : elements.length - 1
          : (index + delta + elements.length) % elements.length;

      activeId.set(elements[next].id);
      elements[next].scrollIntoView({ block: 'nearest' });
    },

    selectActive(event) {
      if (!open()) return false;

      event.preventDefault();
      const active = activeId();
      optionElements()
        .find((element) => element.id === active)
        ?.click();
      return true;
    },
  };
}
