// 3rd Party
import { AttributeSpec, Attrs, Node as ProseMirrorNode, TagParseRule } from 'prosemirror-model';
import {
  Command,
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { chainCommands, splitBlockAs } from 'prosemirror-commands';
import { InputRule } from 'prosemirror-inputrules';
import type { Transform } from 'prosemirror-transform';

// Editables
import { CommandFactory, defineNode, NodeExtension } from './extension';
import { LineCounter } from './numbering';

/**
 * The line: the one block of a line editor, and its unit of text. Every line
 * is a `paragraph` node, and a paragraph knows what kind of line it is.
 *
 * A bullet, a numbered item, a quote or a heading is a paragraph with a
 * `block` attribute, the way WhatsApp's composer holds a list: the marker is
 * *not* in the text. Typing `- ` at the start of a line takes the two
 * characters out and sets the attribute; the dialect's serializer writes the
 * marker back in front of the line on the way to the stored string, and its
 * parser takes it off again on the way in. The line is laid out as what it is
 * while it is typed, which is what a writer coming from a chat client or a
 * notes app expects — a muted `- ` in front of plain text is not that.
 *
 * Keeping every line one node type, rather than nesting list and item nodes,
 * is what keeps the document flat: one paragraph per line of the stored
 * string, so offsets, paste and serialization never have to walk a tree, and
 * every line is laid out by the same few rules.
 *
 * Which shapes exist, what their markers look like and how they count is the
 * dialect's — see {@link LineGrammar}. This file owns what every dialect shares:
 * the commands that change a line's shape, the marker input rule, and the DOM.
 *
 * `dir="auto"` lets a line typed in a right-to-left script lay itself out
 * correctly without the editor having to know the language.
 */

export interface LineAttrs {
  block: string;
  /**
   * Numbered lines only: the number the line shows. Under `typed` numbering it
   * is the number as typed, so `3.` stays `3.`; under `sequential` numbering
   * it is derived and only `start` is data.
   */
  number: number | null;
  /** List items only: 0 at the top, 1 nested under the item above. One level, no more. */
  level: number;
}

/** What a dialect tells the line about its shapes. */
export interface LineGrammar {
  /** The list kinds: they nest, Tab moves them, and a numbered one counts. */
  lists: readonly string[];
  /** The numbered list kind. */
  numbered: string;
  /**
   * The kinds a new line carries on with when a line is split. A heading is
   * not one: the line after a title is prose.
   */
  carriesOn: readonly string[];
  /**
   * `typed`: the number is data, kept as typed and counted on by the commands
   * that make new lines. `sequential`: the number is derived from where the
   * line stands (see `numbering.ts`), and only a run's explicit `start` is
   * data — a list renumbers itself as lines come and go.
   */
  numbering: 'typed' | 'sequential';
  /** The marker a writer types at the start of a line, ending in the space that fires it. */
  markerPattern: RegExp;
  /**
   * The shape a typed marker gives the line at `pos`, or `null` to leave the
   * characters as typed.
   */
  typedShape(marker: string, state: EditorState, pos: number): Attrs | null;
  /**
   * The heading kind. A heading's own marker is an attribute, so its text
   * starts where a line's would: only another heading marker reshapes it —
   * `1. ` or `- ` typed there is the title's text (`# 1. Einleitung`).
   */
  heading: string;
  /**
   * A heading line's depth, 1 for a title — however the dialect stores it.
   * Drawn as `data-depth`, so one stylesheet sizes every dialect's headings,
   * and named by the empty-heading hint (`extensions/heading-placeholder.ts`).
   */
  headingDepth(attrs: Attrs): number;
}

const PLAIN: LineAttrs = { block: 'paragraph', number: null, level: 0 };

const isList = (grammar: LineGrammar, block: string): boolean => grammar.lists.includes(block);

/**
 * Under sequential numbering a line whose shape changes gives up any explicit
 * start: it counts on from the lines around it, which is what a writer means
 * by turning a line into an item. Typed numbering has no `start` attribute.
 */
const counting = (grammar: LineGrammar, attrs: Attrs): Attrs =>
  grammar.numbering === 'sequential' ? { ...attrs, number: null, start: null } : attrs;

/** The count at `pos`: every line before it, advanced through. */
export function counterBefore(
  grammar: LineGrammar,
  doc: ProseMirrorNode,
  pos: number,
): LineCounter {
  const counter = new LineCounter(grammar);
  doc.forEach((line, offset) => {
    if (offset < pos) counter.advance(countedLine(line));
  });
  return counter;
}

const countedLine = (line: ProseMirrorNode) => ({
  block: line.attrs['block'] as string,
  level: line.attrs['level'] as number,
  start: (line.attrs['start'] as number | null | undefined) ?? null,
  blank: line.attrs['block'] === 'paragraph' && line.content.size === 0,
});

/**
 * What a line carries on with when it is split. Under sequential numbering
 * the dialect's own attributes ride along — an item spelled `*` gets a
 * sibling spelled `*` — and only the count starts over.
 */
function continuation(grammar: LineGrammar, attrs: Attrs): Attrs {
  const { block, number, level } = attrs as LineAttrs;
  if (!grammar.carriesOn.includes(block)) return PLAIN;

  if (grammar.numbering === 'sequential') return counting(grammar, attrs);
  return block === grammar.numbered
    ? { block, number: (number ?? 0) + 1, level }
    : { block, number: null, level };
}

/**
 * The marker rule. WhatsApp's: the space after the marker is the keystroke
 * that fires, the marker is removed, and the line takes its shape. Only at
 * the start of a line, which is what `^` means here — the input-rules plugin
 * matches against the text from the start of the textblock. On a heading line
 * only another heading marker fires (see {@link LineGrammar.heading}).
 */
function markerInputRule(grammar: LineGrammar): InputRule {
  return new InputRule(grammar.markerPattern, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parentOffset !== 0) return null;

    const shape = grammar.typedShape(match[0], state, $start.before());
    if (!shape) return null;
    if ($start.parent.attrs['block'] === grammar.heading && shape['block'] !== grammar.heading)
      return null;

    return state.tr.delete(start, end).setNodeMarkup($start.before(), undefined, shape);
  });
}

/** What the input-rules plugin keeps of the rule that fired last, until the next change. */
interface FiredRule {
  transform: Transform;
  from: number;
  to: number;
  text: string;
}

/**
 * Backspace right after a marker fired: the marker comes back as text, and
 * the space that fired it does not — `- ` turned bullet comes back as `-`,
 * the caret after it. Space then fires the rule again; anything else carries
 * on as text (`-5 °C`, `1.5 kg`). So the one key undoes the shape without
 * committing to either reading.
 *
 * ProseMirror's own `undoInputRule` puts the space back too, and that leaves
 * `- ` standing at the start of the line as text — which the format reads as
 * a bullet the next time the value is read, so the line would turn back into
 * a list on its own. Without the space it stays what it looks like.
 */
const unfireMarker: Command = (state, dispatch) => {
  for (const plugin of state.plugins) {
    if (!(plugin.spec as { isInputRules?: boolean }).isInputRules) continue;
    const fired = plugin.getState(state) as FiredRule | null;
    if (!fired) continue;

    if (dispatch) {
      const tr = state.tr;
      const { transform } = fired;
      for (let index = transform.steps.length - 1; index >= 0; index -= 1) {
        tr.step(transform.steps[index].invert(transform.docs[index]));
      }
      // The text that fired was never inserted. Usually that is the space
      // alone, but input that arrives in one piece — autocorrect, an IME,
      // dictation — can bring `- ` whole; everything of it but the space goes
      // in, over whatever it was typed over.
      const kept = fired.text.slice(0, -1);
      if (kept) {
        tr.replaceWith(
          fired.from,
          fired.to,
          state.schema.text(kept, tr.doc.resolve(fired.from).marks()),
        );
      } else {
        tr.delete(fired.from, fired.to);
      }
      dispatch(
        tr.setSelection(TextSelection.create(tr.doc, fired.from + kept.length)).scrollIntoView(),
      );
    }
    return true;
  }
  return false;
};

/**
 * Backspace at the start of a shaped line takes the shape off one step at a
 * time — a nested item comes out to the top level first, then loses its
 * shape — as it does on WhatsApp, before it would join the line above.
 */
function liftLine(grammar: LineGrammar): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0) return false;

    const attrs = $from.parent.attrs as LineAttrs;
    if (attrs.block === 'paragraph') return false;

    const next = attrs.level > 0 ? counting(grammar, { ...attrs, level: 0 }) : PLAIN;
    dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, next).scrollIntoView());
    return true;
  };
}

/**
 * Tab nests the list items in the selection one level; Shift-Tab brings them
 * back out. One level is all there is, so Tab on an already nested item is
 * declined and does what Tab does anywhere else: move focus on. So is Tab on
 * a line that is not an item.
 *
 * Under typed numbering a freshly nested numbered item starts at one, unless
 * the nested item above it is numbered, in which case it counts on from
 * there. Under sequential numbering the count does that by itself.
 */
function shiftLevel(grammar: LineGrammar, delta: 1 | -1): Command {
  return (state, dispatch) => {
    const { from, to, $from } = state.selection;
    const first = $from.parent.attrs as LineAttrs;
    if (!isList(grammar, first.block)) return false;

    const target = first.level + delta;
    if (target < 0 || target > 1) return false;

    if (dispatch) {
      const tr = state.tr;
      let number = target === 1 ? nestedNumberBefore(grammar, state, $from.before()) : 0;

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        const attrs = node.attrs as LineAttrs;
        if (!isList(grammar, attrs.block)) return false;

        if (grammar.numbering === 'sequential') {
          tr.setNodeMarkup(pos, undefined, counting(grammar, { ...attrs, level: target }));
          return false;
        }

        number += 1;
        const renumbered =
          attrs.block === grammar.numbered ? (target === 1 ? number : attrs.number) : null;
        tr.setNodeMarkup(pos, undefined, { ...attrs, level: target, number: renumbered });
        return false;
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The number of the nested numbered item right above `pos`, or zero. */
function nestedNumberBefore(grammar: LineGrammar, state: EditorState, pos: number): number {
  const above = state.doc.resolve(pos).nodeBefore;
  const attrs = above?.attrs as LineAttrs | undefined;
  return attrs?.block === grammar.numbered && attrs.level === 1 ? (attrs.number ?? 0) : 0;
}

/**
 * A new line, carrying the shape on. An empty shaped line is the way out — a
 * second split on it ends the list with a plain line, the convention every
 * list editor shares.
 */
function splitLine(grammar: LineGrammar): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    const attrs = $from.parent.attrs as LineAttrs;

    if (empty && attrs.block !== 'paragraph' && $from.parent.content.size === 0) {
      dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, PLAIN).scrollIntoView());
      return true;
    }

    return splitBlockAs((node: ProseMirrorNode) => ({
      type: node.type,
      attrs: continuation(grammar, node.attrs),
    }))(state, dispatch);
  };
}

/**
 * Gives every line in the selection the block shape, or takes it off every
 * line if the first already has it — a toolbar toggle. `attrs` rides along
 * for a shape that carries more than its kind, a heading's depth.
 *
 * Under typed numbering, numbered lines count from the line above when that
 * is numbered, so a list grows rather than restarting at one. Under
 * sequential numbering the count does that by itself.
 */
export function toggleLine(grammar: LineGrammar, block: string, attrs: Attrs = {}): Command {
  return (state, dispatch) => {
    if (!(state.selection instanceof TextSelection)) return false;
    const { from, to, $from } = state.selection;
    const first = $from.parent.attrs as LineAttrs;
    const target = first.block === block ? 'paragraph' : block;

    if (dispatch) {
      const tr = state.tr;
      let number = target === grammar.numbered ? numberBefore(grammar, state, $from.before()) : 0;

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;

        if (grammar.numbering === 'sequential') {
          const shape = target === 'paragraph' ? PLAIN : { ...attrs, block: target, level: 0 };
          tr.setNodeMarkup(pos, undefined, counting(grammar, shape));
          return false;
        }

        number += 1;
        tr.setNodeMarkup(pos, undefined, {
          ...(target === 'paragraph' ? {} : attrs),
          block: target,
          number: target === grammar.numbered ? number : null,
          level: 0,
        });
        return false;
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The number of the numbered line right above `pos`, or zero. */
function numberBefore(grammar: LineGrammar, state: EditorState, pos: number): number {
  const above = state.doc.resolve(pos).nodeBefore;
  const attrs = above?.attrs as LineAttrs | undefined;
  return attrs?.block === grammar.numbered ? (attrs.number ?? 0) : 0;
}

/**
 * Sequential numbering's painter: after every change, every numbered line is
 * given the number the count says it shows, and only the lines whose number
 * moved are touched. Appended to the change that caused it, so one undo takes
 * back the edit and its renumbering together.
 *
 * A marker rule that just fired rides along on the appended change: the
 * input-rules plugin forgets a rule at the next change to the document, and
 * the renumbering is one — without this, Backspace after `1. ` would find
 * nothing to give back (see `unfireMarker`).
 */
function renumberPlugin(grammar: LineGrammar): Plugin {
  return new Plugin({
    key: new PluginKey('lineNumbering'),
    appendTransaction: (transactions, _old, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;

      const counter = new LineCounter(grammar);
      let tr: Transaction | null = null;

      state.doc.forEach((line, offset) => {
        const number = counter.advance(countedLine(line));
        if (line.attrs['number'] !== number) {
          tr ??= state.tr;
          tr.setNodeMarkup(offset, undefined, { ...line.attrs, number });
        }
      });

      // Assigned inside the callback, which narrowing does not follow.
      const renumbered = tr as Transaction | null;
      if (renumbered) {
        const rules = state.plugins.find(
          (plugin) => (plugin.spec as { isInputRules?: boolean }).isInputRules,
        );
        const fired =
          rules && transactions.map((transaction) => transaction.getMeta(rules)).find(Boolean);
        if (fired) renumbered.setMeta(rules, fired);
      }

      return renumbered;
    },
  });
}

const holdsParagraphs = (node: HTMLElement): boolean => node.querySelector(':scope > p') !== null;

/**
 * A pasted list item's shape from its list. The number is the item's own
 * `value` if set, else its position counted from the list's `start` — kept by
 * typed numbering, recounted by sequential numbering.
 */
function listItemAttrs(item: HTMLElement): LineAttrs {
  const list = item.parentElement;
  // Inside another item: nested. Deeper than that is folded to one level.
  const level = list?.parentElement?.closest('li') ? 1 : 0;
  if (list?.tagName !== 'OL') return { block: 'bullet', number: null, level };

  const value = Number(item.getAttribute('value'));
  const start = Number(list.getAttribute('start')) || 1;
  const items = Array.from(list.children).filter((child) => child.tagName === 'LI');
  return { block: 'number', number: value || start + items.indexOf(item), level };
}

/**
 * The paste rules every dialect shares: a pasted list keeps its shape. An item
 * that holds paragraphs (Word, Notion and this app's own clipboard write them
 * so) is read through those paragraphs, or each would give an empty line
 * followed by a plain one.
 */
export const LIST_ITEM_PARSE_RULES: readonly TagParseRule[] = [
  { tag: 'li > p', getAttrs: (node) => listItemAttrs(node.parentElement!), priority: 60 },
  { tag: 'li', getAttrs: (node) => (holdsParagraphs(node) ? false : listItemAttrs(node)) },
];

export interface LineNodeOptions {
  grammar: LineGrammar;
  /** Attributes beyond `block`, `number` and `level` — a heading's depth. */
  attrs?: Record<string, AttributeSpec>;
  /** How pasted HTML becomes lines, in priority order. */
  parseDOM: readonly TagParseRule[];
  /** The keys that split a line: Shift-Enter where Enter sends, both where it does not. */
  splitKeys: readonly string[];
  /** Named commands — the dialect's toggles. */
  commands?: () => Record<string, CommandFactory>;
  /** Key bindings beyond the shared ones — the dialect's toggle shortcuts. */
  keymap?: () => Record<string, Command>;
}

/** Builds a dialect's line node from its grammar. */
export function defineLineNode(options: LineNodeOptions): NodeExtension {
  const { grammar } = options;
  const sequential = grammar.numbering === 'sequential';

  const split = splitLine(grammar);
  const splitBindings = Object.fromEntries(options.splitKeys.map((key) => [key, split]));

  return defineNode({
    name: 'paragraph',
    spec: {
      content: 'inline*',
      group: 'block',
      attrs: {
        block: { default: 'paragraph' },
        number: { default: null },
        level: { default: 0 },
        ...(sequential ? { start: { default: null } } : {}),
        ...options.attrs,
      },
      parseDOM: [...options.parseDOM],
      toDOM: (node) => {
        const { block, number, level } = node.attrs as LineAttrs;
        const attrs: Record<string, string> = { dir: 'auto' };
        if (block !== 'paragraph') attrs['data-block'] = block;
        if (block === grammar.numbered) attrs['data-number'] = String(number ?? 1);
        if (level > 0) attrs['data-level'] = String(level);
        if (block === grammar.heading)
          attrs['data-depth'] = String(grammar.headingDepth(node.attrs));
        return ['p', attrs, 0];
      },
    },
    commands: options.commands,
    keymap: () => ({
      ...splitBindings,
      Tab: shiftLevel(grammar, 1),
      'Shift-Tab': shiftLevel(grammar, -1),
      ...options.keymap?.(),
      // The rule undo first: one Backspace right after `- ` fired gives the
      // marker back without its space — see `unfireMarker`.
      Backspace: chainCommands(unfireMarker, liftLine(grammar)),
    }),
    inputRules: () => [markerInputRule(grammar)],
    plugins: sequential ? () => [renumberPlugin(grammar)] : undefined,
  });
}
