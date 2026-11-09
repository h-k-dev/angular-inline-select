// 3rd Party
import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';

// Editables
import { FunctionalExtension, defineExtension } from '../extension';

/**
 * A suggestion menu — angular-email-editor's (`suggestion-menu.ts`), slimmed
 * to what a line editor's `/` needs: one trigger, one level, a list the host
 * gives. Its names are the library's, so the two can be reconciled by
 * deletion. Typing the trigger — at the start of a word, unless told
 * otherwise (`startOfWord`) — opens a list under it,
 * the text after it searches the list, and picking an item takes the trigger
 * and the query out and runs what the item does at that spot.
 *
 * **Read from the text.** A session is a caret right after
 * `<trigger><query>`, however the text got there; nothing else is held, so
 * undo, paste and a caret moved back into a query all land right.
 *
 * **The editor is the combobox.** The focus never leaves it: the arrows move
 * the one highlight, Enter or Tab pick, Escape dismisses — and that session
 * stays shut until the caret has been somewhere else. The pointer moves the
 * same highlight (`highlight`): hover is not a second one. The host renders
 * the list from the state (`onChange`) and places it at the trigger
 * (`clientRect`).
 *
 * **Marked in the text.** While a session lasts, its trigger and query are a
 * `<span class="m-suggestion">`, with the trigger's placeholder as
 * `data-hint` while the query is empty — for the host's stylesheet; not
 * `data-placeholder`, which an empty line's own hint is (`placeholder.ts`).
 * Nothing of it is in the document.
 *
 * **One per trigger.** An editor may hold several (`/` and `{{`), each its
 * own `createSuggestionMenu`: a caret is in one session at most.
 */

/** A suggestion that acts: picking it deletes the trigger and query text,
    then runs `command` at that spot. */
export interface SuggestionCommandItem {
  /** Stable and locale-neutral (`'heading-2'`): what a renderer tracks rows by. */
  id: string;
  /** Shown, and matched first. */
  title: string;
  /** Further words the query is matched against. */
  keywords?: readonly string[];
  /** A Material Symbols glyph, for a renderer that shows one. */
  icon?: string;
  /** A second, quieter line under the title (`cf_70`). */
  detail?: string;
  /** The heading the item is listed under — a section's items listed
      together, where its best match ranks. */
  section?: string;
  /** Runs after the trigger and query text have been deleted. */
  command: Command;
}

export interface SuggestionMenuState {
  /** A session with matches: the list shows. */
  open: boolean;
  trigger: string;
  /** Everything typed after the trigger. */
  query: string;
  /** The items matching the query, best first. */
  items: readonly SuggestionCommandItem[];
  /** The highlighted item. */
  activeIndex: number;
  /** The trigger's first character to the caret; null while closed. */
  range: { from: number; to: number } | null;
  /** The trigger's box in viewport coordinates, measured when called. */
  clientRect: () => DOMRect | null;
  /** Takes the trigger and the query out, and runs the item. */
  select: (item: SuggestionCommandItem) => void;
  /** The pointer's highlight: the same one the arrows move. */
  highlight: (index: number) => void;
  /** Closes the menu as Escape does. */
  dismiss: () => void;
}

export interface SuggestionMenuOptions {
  /** What opens the menu when typed. Default `/`. */
  trigger?: string;
  /** Whether the trigger opens only at the start of a word — the block's
      start, after whitespace or an inline leaf. Default true; `{{` opens
      anywhere. */
  startOfWord?: boolean;
  /** What counts as a query. Default: not starting with whitespace (`/ ` is
      text), nothing of the trigger's first character in it (a later one is a
      new session), spaces between words. */
  query?: RegExp;
  /** The menu's items, asked whenever a session opens — in the words of
      the moment, so a language switch reaches them. */
  items: () => readonly SuggestionCommandItem[];
  onChange: (state: SuggestionMenuState) => void;
  /** Shown after the bare trigger, until a query is typed. */
  placeholder?: () => string;
  /** The host's veto, asked per state: no session where it says no — a
      block the menu's items would not know what to do with. */
  allow?: (state: EditorState) => boolean;
  /** The longest query that still counts as one. Default 40. */
  maxLength?: number;
  /** The most matches listed — the best; typing narrows to the rest. For a
      list too long to draw whole (a case group's fields). Default all. */
  limit?: number;
}

interface Session {
  /** The trigger's first character. */
  from: number;
  /** The caret: the end of the query. */
  to: number;
  query: string;
}

interface MenuState {
  session: Session | null;
  /** Where the dismissed session starts, mapped with the text; held until
      the caret is out of it. */
  dismissed: number | null;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The items holding every word of `query` in their title or keywords, best
    first: the title itself, the title's start, anywhere in the title, a
    keyword alone — the given order within each. The library's matching. */
export function matchSuggestions<T extends SuggestionCommandItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matching = items.filter((item) => {
    const haystack = [item.title, ...(item.keywords ?? [])].map((entry) => entry.toLowerCase());
    return words.every((word) => haystack.some((entry) => entry.includes(word)));
  });
  if (!q) return matching;
  const tier = (item: T) => {
    const title = item.title.toLowerCase();
    return title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : 3;
  };
  return matching
    .map((item, index) => ({ item, index, tier: tier(item) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.item);
}

/** The items, each section together where its best ranks: one heading per
    section, the best match still first. */
function bySection<T extends SuggestionCommandItem>(items: readonly T[]): T[] {
  const sections = new Map<string | undefined, T[]>();
  for (const item of items) {
    const rows = sections.get(item.section);
    if (rows) rows.push(item);
    else sections.set(item.section, [item]);
  }
  return [...sections.values()].flat();
}

export const createSuggestionMenu = (options: SuggestionMenuOptions): FunctionalExtension => {
  const trigger = options.trigger ?? '/';
  const maxLength = options.maxLength ?? 40;
  const key = new PluginKey<MenuState>('suggestionMenu');
  // Not starting with whitespace (`/ ` is text), no trigger inside (a later
  // one is a new session), spaces between words allowed (`/überschrift 2`).
  const first = escapeRegExp(trigger[0]);
  const queryPattern = options.query ?? new RegExp(`^(?:[^\\s${first}][^${first}]*)?$`);
  const startOfWord = options.startOfWord ?? true;

  /** A caret right after `<trigger><query>` — at the start of a word (the
      block's, after whitespace or after an inline leaf, a `<br>`) where
      `startOfWord` asks. */
  const findSession = (state: EditorState): Session | null => {
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock || (options.allow && !options.allow(state))) return null;
    const start = Math.max(0, $from.parentOffset - (maxLength + trigger.length + 1));
    const before = $from.parent.textBetween(start, $from.parentOffset, undefined, '\ufffc');
    const at = before.lastIndexOf(trigger);
    if (at < 0) return null;
    const query = before.slice(at + trigger.length);
    if (query.length > maxLength || !queryPattern.test(query)) return null;
    if (startOfWord) {
      const prefix = at > 0 ? before[at - 1] : start > 0 ? null : '';
      if (prefix === null || (prefix && !/[\s\ufffc]/.test(prefix))) return null;
    }
    return { from: $from.pos - query.length - trigger.length, to: $from.pos, query };
  };

  let view: EditorView | null = null;
  /** The session's list: asked when it opens, matched per query. */
  let given: readonly SuggestionCommandItem[] = [];
  let items: readonly SuggestionCommandItem[] = [];
  let activeIndex = 0;
  let shown: Session | null = null;

  const session = () => (view ? (key.getState(view.state)?.session ?? null) : null);

  const select = (item: SuggestionCommandItem) => {
    const current = session();
    if (!view || !current) return;
    view.dispatch(view.state.tr.delete(current.from, current.to));
    item.command(view.state, view.dispatch, view);
    view.focus();
  };

  const dismiss = () => {
    if (view && session()) view.dispatch(view.state.tr.setMeta(key, { dismiss: true }));
  };

  const report = () => {
    const current = session();
    options.onChange({
      open: !!current && items.length > 0,
      trigger,
      query: current?.query ?? '',
      items,
      activeIndex,
      range: current && { from: current.from, to: current.to },
      clientRect: () => {
        const at = session();
        if (!view || !at) return null;
        const { left, top, bottom } = view.coordsAtPos(at.from);
        return {
          left,
          top,
          bottom,
          right: left,
          width: 0,
          height: bottom - top,
          x: left,
          y: top,
          toJSON: () => '',
        } as DOMRect;
      },
      select,
      highlight: (index) => {
        if (index === activeIndex || index < 0 || index >= items.length) return;
        activeIndex = index;
        report();
      },
      dismiss,
    });
  };

  /** The menu after a state: the session's list matched again when its
      query changed, the highlight back on the first match. */
  const update = (state: EditorState) => {
    const current = key.getState(state)?.session ?? null;
    if (current?.from === shown?.from && current?.query === shown?.query && current?.to === shown?.to) return;
    if (current && current.from !== shown?.from) given = options.items();
    items = current ? bySection(matchSuggestions(given, current.query).slice(0, options.limit)) : [];
    activeIndex = 0;
    shown = current;
    report();
  };

  return defineExtension({
    name: 'suggestionMenu',
    plugins: () => [
      new Plugin<MenuState>({
        key,
        state: {
          init: (_, state) => ({ session: findSession(state), dismissed: null }),
          apply: (tr, previous, _, state) => {
            const found = findSession(state);
            const dismissed = previous.dismissed === null ? null : tr.mapping.map(previous.dismissed);
            if (tr.getMeta(key)?.dismiss && found) return { session: null, dismissed: found.from };
            // Still in the dismissed session: it stays shut.
            if (found && found.from === dismissed) return { session: null, dismissed };
            return { session: found, dismissed: null };
          },
        },
        props: {
          handleKeyDown: (editorView, event) => {
            if (!shown || !items.length || event.ctrlKey || event.metaKey || event.altKey) return false;
            switch (event.key) {
              case 'ArrowDown':
              case 'ArrowUp':
                activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                report();
                return true;
              case 'Enter':
              case 'Tab':
                select(items[activeIndex]);
                return true;
              case 'Escape':
                // The Escape is the menu's: what is around the editor (a
                // dialog that closes on Escape) never hears it.
                event.stopPropagation();
                editorView.dispatch(editorView.state.tr.setMeta(key, { dismiss: true }));
                return true;
              default:
                return false;
            }
          },
          decorations: (state) => {
            const current = key.getState(state)?.session;
            if (!current) return null;
            // Until a query is typed — `{{ ` is no query yet.
            const placeholder = current.query.trim() ? null : options.placeholder?.();
            return DecorationSet.create(state.doc, [
              Decoration.inline(current.from, current.to, {
                class: 'm-suggestion',
                ...(placeholder ? { 'data-hint': placeholder } : {}),
              }),
            ]);
          },
        },
        view: (editorView) => {
          view = editorView;
          update(editorView.state);
          return {
            update: (next) => update(next.state),
            destroy: () => {
              view = null;
              shown = null;
              items = [];
              report();
            },
          };
        },
      }),
    ],
  });
};
