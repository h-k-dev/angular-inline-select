/**
 * The prompt format: Markdown's line shapes, the ones a language model reads
 * without being told how.
 *
 *   `# heading` … `###### heading`   `- item`   `1. item`
 *
 * and one level of nesting, an item indented under the item above it. The
 * indent is the width of the parent's marker — two spaces under `- `, three
 * under `1. ` — which is where CommonMark puts a nested list, so the stored
 * prompt renders as what it looks like anywhere Markdown is rendered.
 *
 * Numbers are counted, not typed (see `line/numbering.ts`): a list renumbers
 * itself as items come and go, and the stored string is always in sequence.
 *
 * **Reading a stored prompt is exact.** Every string reads back to a document
 * that writes the same string again, byte for byte — a prompt saved before
 * this editor existed must not be rewritten by opening it. So whatever a line
 * says that the canonical spelling would not, the line keeps as data: a list
 * whose number does not follow from the count keeps it as `start`, a bullet
 * spelled `*` keeps its character, a nested item indented by its own count of
 * spaces keeps that count. What the format cannot say at all — a third level,
 * `1)`, a heading without its space — stays text.
 *
 * **Reading a paste is lenient**, because it is new content: indents, bullet
 * characters and numbers are taken as shapes and written canonically.
 */

// Editables
import { CountedKinds, LineCounter } from '../line/numbering';

export type PromptBlockKind = 'paragraph' | 'heading' | 'bullet' | 'number';

export const PROMPT_KINDS: CountedKinds = { lists: ['bullet', 'number'], numbered: 'number' };

/** One line's shape, everything but its text. */
export interface PromptLineShape {
  block: PromptBlockKind;
  /** List items only: 0 at the top, 1 nested under the item above. */
  level: number;
  /** Numbered lines only: the number the line shows. */
  number: number | null;
  /** Numbered lines only: the explicit first number of a run, `null` to count on. */
  start: number | null;
  /** Headings only: how many `#` — 1 to 6. */
  depth: number | null;
  /** Bullets only: the character, when it is not the canonical `-`. */
  bullet: string | null;
  /** Nested items only: the indent, when it is not the canonical one. */
  indent: number | null;
}

export interface PromptTextLine {
  shape: PromptLineShape;
  text: string;
}

export const PLAIN_SHAPE: PromptLineShape = {
  block: 'paragraph',
  level: 0,
  number: null,
  start: null,
  depth: null,
  bullet: null,
  indent: null,
};

const HEADING = /^(#{1,6}) /;
const STORED_ITEM = /^( *)(?:([-*+])|(\d{1,3})\.) /;

/** The indent a nested item takes when nothing says otherwise. */
const DEFAULT_NEST = 2;

/**
 * Tracks what a nested line's canonical indent is: the width of the marker of
 * the top-level item it sits under. An item stays the parent across nested
 * and empty lines, and anything else — prose, a heading — leaves nested lines
 * without one, so they take the default.
 */
class NestTracker {
  #parent: number | null = null;

  get indent(): number {
    return this.#parent ?? DEFAULT_NEST;
  }

  advance(shape: PromptLineShape, marker: string, blank: boolean): void {
    if (PROMPT_KINDS.lists.includes(shape.block)) {
      if (shape.level === 0) this.#parent = marker.length;
    } else if (!blank) {
      this.#parent = null;
    }
  }
}

const isBlank = (shape: PromptLineShape, text: string): boolean =>
  shape.block === 'paragraph' && text.length === 0;

/** The marker a line writes in front of its text, given the indent nesting asks for. */
function markerOf(shape: PromptLineShape, nest: number): string {
  const indent = shape.level > 0 ? ' '.repeat(shape.indent ?? nest) : '';

  switch (shape.block) {
    case 'heading':
      return `${'#'.repeat(shape.depth ?? 1)} `;
    case 'bullet':
      return `${indent}${shape.bullet ?? '-'} `;
    case 'number':
      return `${indent}${shape.number ?? 1}. `;
    default:
      return '';
  }
}

/**
 * Reads a prompt into lines. `stored` is the exact reading of a saved value;
 * `pasted` the lenient one of new content — see the module comment.
 */
export function readPromptLines(
  value: string,
  mode: 'stored' | 'pasted' = 'stored',
): PromptTextLine[] {
  const counter = new LineCounter(PROMPT_KINDS);
  const nest = new NestTracker();
  const lenient = mode === 'pasted';

  return value.split('\n').map((line) => {
    const { shape, length } = readShape(line, counter, nest.indent, lenient);
    const text = line.slice(length);

    shape.number = counter.advance({ ...shape, blank: isBlank(shape, text) });
    nest.advance(shape, line.slice(0, length), isBlank(shape, text));
    return { shape, text };
  });
}

function readShape(
  line: string,
  counter: LineCounter,
  nest: number,
  lenient: boolean,
): { shape: PromptLineShape; length: number } {
  const heading = HEADING.exec(line);
  if (heading) {
    return {
      shape: { ...PLAIN_SHAPE, block: 'heading', depth: heading[1].length },
      length: heading[0].length,
    };
  }

  const item = STORED_ITEM.exec(line);
  if (!item) return { shape: { ...PLAIN_SHAPE }, length: 0 };

  const [marker, spaces, bullet, digits] = item;
  const level = spaces.length > 0 ? 1 : 0;
  const shape: PromptLineShape = { ...PLAIN_SHAPE, level };

  if (level > 0 && !lenient && spaces.length !== nest) shape.indent = spaces.length;

  if (bullet) {
    shape.block = 'bullet';
    if (!lenient && bullet !== '-') shape.bullet = bullet;
  } else {
    const typed = Number(digits);
    shape.block = 'number';
    // A leading zero spells a number that is never written back that way, so
    // `07.` would not read back as typed: such a line stays text.
    if (!lenient && String(typed) !== digits) return { shape: { ...PLAIN_SHAPE }, length: 0 };
    if (!lenient && typed !== counter.expected(level)) shape.start = typed;
  }

  return { shape, length: marker.length };
}

/** Writes lines back as the stored prompt — the inverse of a stored {@link readPromptLines}. */
export function writePromptLines(lines: Iterable<PromptTextLine>): string {
  const counter = new LineCounter(PROMPT_KINDS);
  const nest = new NestTracker();
  const out: string[] = [];

  for (const { shape, text } of lines) {
    const blank = isBlank(shape, text);
    const counted = counter.advance({ ...shape, blank });
    // A copied fragment that starts mid-list has its numbers already; a whole
    // document's agree with the count, since the editor keeps them so.
    const numbered =
      shape.block === 'number' ? { ...shape, number: shape.number ?? counted } : shape;

    const marker = markerOf(numbered, nest.indent);
    nest.advance(numbered, marker, blank);
    out.push(marker + text);
  }

  return out.join('\n');
}

/**
 * The typed marker rule: Markdown's markers, read leniently — a writer typing
 * `* ` means a bullet as much as one typing `- `. Fires on the space.
 */
export const TYPED_MARKER = /^(?:(#{1,6})|( {1,4})?(?:([-*+])|(\d{1,3})\.)) $/;
