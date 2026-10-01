/**
 * Sequential numbering: the number a numbered line shows is counted from where
 * it stands, not typed. Markdown's rule — a list counts on from its first
 * item — with one addition that keeps a stored string exact: a line whose
 * number does not follow from the count carries it as `start`, and the count
 * goes on from there.
 *
 * This module is the only place the count is decided. Reading a stored string
 * uses it to find the lines that need a `start`, the editor uses it after every
 * change to repaint the numbers, and the serializer writes what it produced, so
 * the three cannot disagree.
 *
 * What a run is:
 *
 * - Numbered lines at the top level count on from each other, across nested
 *   lines and across empty lines (a loose list is still one list). A plain
 *   line with text, a heading or a top-level bullet ends the run.
 * - Nested numbered lines count on their own and start over under every
 *   top-level item. A nested bullet ends the nested run.
 */

/** What the count needs to know about a line. */
export interface CountedLine {
  block: string;
  level: number;
  /** The explicit first number of a run, or `null` to count on. */
  start: number | null;
  /** A plain line with no text — a run carries on across it. */
  blank: boolean;
}

/** Which kinds are list items, and which of those are numbered. */
export interface CountedKinds {
  lists: readonly string[];
  numbered: string;
}

/**
 * The count at one point of a document, advanced line by line. `open[level]`
 * is the number the last numbered line of that level showed, or 0 when no run
 * is open there.
 */
export class LineCounter {
  readonly #kinds: CountedKinds;
  readonly #open = [0, 0];

  constructor(kinds: CountedKinds) {
    this.#kinds = kinds;
  }

  /** Whether a run is open at `level` — whether a numbered line there would count on. */
  isOpen(level: number): boolean {
    return this.#open[level] > 0;
  }

  /** The number a numbered line at `level` gets by counting on. */
  expected(level: number): number {
    return this.#open[level] + 1;
  }

  /**
   * Moves past a line. Returns the number it shows when it is numbered — its
   * `start` if it has one, else the count — and `null` otherwise.
   */
  advance(line: CountedLine): number | null {
    const { lists, numbered } = this.#kinds;

    if (!lists.includes(line.block)) {
      if (!line.blank) this.#open.fill(0);
      return null;
    }

    const level = Math.min(line.level, 1);
    const number = line.block === numbered ? (line.start ?? this.expected(level)) : null;

    if (level === 0) this.#open[1] = 0;
    this.#open[level] = number ?? 0;
    return number;
  }
}

/** The number every line shows, `null` for the lines that are not numbered. */
export function countLines(lines: Iterable<CountedLine>, kinds: CountedKinds): (number | null)[] {
  const counter = new LineCounter(kinds);
  return Array.from(lines, (line) => counter.advance(line));
}
