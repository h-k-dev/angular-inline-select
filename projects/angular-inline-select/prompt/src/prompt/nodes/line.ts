// 3rd Party
import { Attrs, TagParseRule } from 'prosemirror-model';
import { Command } from 'prosemirror-state';

// Editables
import {
  counterBefore,
  defineLineNode,
  LIST_ITEM_PARSE_RULES,
  LineGrammar,
  toggleLine,
} from '../../line/line-node';
import { PROMPT_KINDS, PromptBlockKind, TYPED_MARKER } from '../format';

/**
 * The prompt editor's line: the shared line node (`line/line-node.ts`) with
 * Markdown's shapes — a heading, a bullet, a numbered item.
 *
 * Numbers are counted (see `line/numbering.ts`): a typed `5. ` opens a list at
 * five, but typed directly under an item it simply counts on — inside a list
 * the count decides, not the digit.
 */
export const PROMPT_LINE_GRAMMAR: LineGrammar = {
  ...PROMPT_KINDS,
  carriesOn: ['bullet', 'number'],
  numbering: 'sequential',
  markerPattern: TYPED_MARKER,
  typedShape: (typed, state, pos) => {
    const match = TYPED_MARKER.exec(typed);
    if (!match) return null;

    const [, hashes, spaces, bullet, digits] = match;
    if (hashes) return { block: 'heading', depth: hashes.length };

    // A marker typed into a line that is already a nested item re-shapes it in
    // place: Tab then `- ` gives a nested bullet, as it reads.
    const line = state.doc.resolve(pos).nodeAfter;
    const nested = PROMPT_KINDS.lists.includes(line?.attrs['block']) && line?.attrs['level'] === 1;
    const level = spaces || nested ? 1 : 0;
    if (bullet) return { block: 'bullet', level };

    const number = Number(digits);
    const counter = counterBefore(PROMPT_LINE_GRAMMAR, state.doc, pos);
    const start = counter.isOpen(level) || number === counter.expected(level) ? null : number;
    return { block: 'number', level, start };
  },
  // A prompt heading keeps its depth, one to six, in `depth`.
  heading: 'heading',
  headingDepth: (attrs) => (attrs['depth'] as number | null) ?? 1,
};

const KINDS: readonly PromptBlockKind[] = ['paragraph', 'heading', 'bullet', 'number'];

/**
 * A line copied as it is drawn reads back as itself — a selection of a
 * prompt at rest, which the browser copies as the static lines, `toDOM`'s
 * own elements. The number is left to the count, as for any paste. A copy
 * out of the editor carries semantic HTML instead (`clipboard.ts`).
 */
function ownLineAttrs(node: HTMLElement): Attrs | false {
  const block = node.getAttribute('data-block') as PromptBlockKind;
  if (!KINDS.includes(block)) return false;

  return {
    block,
    level: Number(node.getAttribute('data-level')) || 0,
    depth: block === 'heading' ? Number(node.getAttribute('data-depth')) || 1 : null,
  };
}

const HEADING_PARSE_RULES: TagParseRule[] = [1, 2, 3, 4, 5, 6].map((depth) => ({
  tag: `h${depth}`,
  attrs: { block: 'heading', depth },
}));

/** Google Docs' heading bindings: Mod-Alt and the depth. */
const headingKeys = (): Record<string, Command> =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((depth) => [
      `Mod-Alt-${depth}`,
      toggleLine(PROMPT_LINE_GRAMMAR, 'heading', { depth }),
    ]),
  );

export const PromptLine = defineLineNode({
  grammar: PROMPT_LINE_GRAMMAR,
  attrs: {
    depth: { default: null },
    bullet: { default: null },
    indent: { default: null },
  },
  parseDOM: [
    { tag: 'p[data-block]', getAttrs: ownLineAttrs, priority: 70 },
    ...LIST_ITEM_PARSE_RULES,
    ...HEADING_PARSE_RULES,
    { tag: 'p' },
  ],
  // The depth is drawn as `data-depth` by the line itself (`line-node.ts`),
  // from the grammar's `headingDepth` — the same attribute every dialect uses.
  // No send: both keys make a new line, the way every text field does.
  splitKeys: ['Enter', 'Shift-Enter'],
  commands: () => ({
    toggleHeading: (depth = 1) => toggleLine(PROMPT_LINE_GRAMMAR, 'heading', { depth }),
    toggleBullet: () => toggleLine(PROMPT_LINE_GRAMMAR, 'bullet'),
    toggleNumber: () => toggleLine(PROMPT_LINE_GRAMMAR, 'number'),
  }),
  keymap: () => ({
    // The chat composer's list bindings, Slack's and Google Docs': bullets on
    // 8 (the asterisk's key), numbers on 7.
    'Mod-Shift-8': toggleLine(PROMPT_LINE_GRAMMAR, 'bullet'),
    'Mod-Shift-7': toggleLine(PROMPT_LINE_GRAMMAR, 'number'),
    ...headingKeys(),
  }),
});
