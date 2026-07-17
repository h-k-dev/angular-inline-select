/**
 * A tiny, hand-rolled Wadler/Lindig-style pretty-printer scoped to exactly
 * one job: JSON. Not a general Doc algebra — there is no `text`/`line`/
 * `group` combinator library here, just direct recursion over parsed JSON
 * values, because that is all this problem needs and it keeps the whole
 * module (and the `json` entry point's bundle) small.
 *
 * Two printers live here, with very different cost profiles:
 * - `printJson` — full pretty-print (paste/reformat), O(document size).
 * - `previewJsonLines` — bounded idle-display preview, O(maxLines) ALWAYS,
 *   regardless of how large the underlying value is. It never materializes
 *   (builds indented text for) more than a `maxLines`-worth of content: a
 *   `tryFlat` attempt bails the instant its accumulated width exceeds the
 *   budget (never visits the remainder of a wide/huge value), and container
 *   truncation only recurses into the handful of entries actually chosen
 *   for the head/tail slices — the skipped middle is never visited at all.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const INDENT_UNIT = '  ';

function indentStr(depth: number): string {
  return INDENT_UNIT.repeat(depth);
}

function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object';
}

function entriesOf(value: JsonValue[] | { [key: string]: JsonValue }): Array<[string | null, JsonValue]> {
  return Array.isArray(value)
    ? value.map((v): [string | null, JsonValue] => [null, v])
    : Object.entries(value);
}

// -----------------------------------------------------------------------------
// Full pretty-print — paste/reformat. Native JSON.stringify already produces
// exactly what a code editor's "prettify" is expected to look like (always
// expanded, one entry per line); no group/fits-flat decisions belong here —
// those exist only to make the tight preview budget below worth the lines.
// -----------------------------------------------------------------------------
export function printJson(value: JsonValue, indent = 2): string {
  return JSON.stringify(value, null, indent);
}

/** Keys safe to print bare in the EDITOR — same shape `quoteBareKeys` re-quotes on parse. */
const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The EDITOR's pretty-print: identical layout to `printJson`, but identifier
 * keys render bare (`role:` not `"role":`) — the typing-friendly form the
 * codec's bare-key leniency accepts back. The committed model never sees
 * this form: commit canonicalizes through strict `JSON.stringify` (double
 * quotes), so what lands in the database is always strict JSON.
 */
export function printEditableJson(value: JsonValue, depth = 0): string {
  if (!isContainer(value)) return JSON.stringify(value);

  const pad = INDENT_UNIT.repeat(depth + 1);
  const close = INDENT_UNIT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const body = value.map((child) => pad + printEditableJson(child, depth + 1)).join(',\n');
    return `[\n${body}\n${close}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';

  const body = entries
    .map(([key, child]) => {
      const printedKey = BARE_KEY.test(key) ? key : JSON.stringify(key);
      return `${pad}${printedKey}: ${printEditableJson(child, depth + 1)}`;
    })
    .join(',\n');

  return `{\n${body}\n${close}}`;
}

// -----------------------------------------------------------------------------
// Bounded preview — the idle in-flow display.
// -----------------------------------------------------------------------------
export interface JsonPreviewOptions {
  /** Hard cap on the number of rendered lines. Default 5. */
  maxLines?: number;
  /** Max characters a value may flatten to before a container is forced to expand. Default 60. */
  flatWidth?: number;
}

export interface JsonPreview {
  lines: string[];
  truncated: boolean;
}

interface ResolvedOptions {
  maxLines: number;
  flatWidth: number;
}

export function previewJsonLines(value: JsonValue, options?: JsonPreviewOptions): JsonPreview {
  const opts: ResolvedOptions = {
    maxLines: options?.maxLines ?? 5,
    flatWidth: options?.flatWidth ?? 60,
  };

  return renderBounded(value, Math.max(opts.maxLines, 1), 0, opts);
}

/**
 * Tries to render `value` as one flat, single-line string no longer than
 * `flatWidth` (measured from `currentLength`, so nesting inside an
 * already-long prefix bails sooner). Returns `null` the moment the
 * accumulated prefix exceeds the budget — it never finishes walking a
 * value that was always going to be too wide, so a huge sibling doesn't
 * cost anything once the budget is blown.
 */
function tryFlat(value: JsonValue, flatWidth: number, currentLength = 0): string | null {
  if (currentLength > flatWidth) return null;

  if (!isContainer(value)) return JSON.stringify(value);

  const entries = entriesOf(value);
  const isArr = Array.isArray(value);
  if (entries.length === 0) return isArr ? '[]' : '{}';

  let acc = `${isArr ? '[' : '{'} `;

  for (let i = 0; i < entries.length; i++) {
    if (currentLength + acc.length > flatWidth) return null;

    const [key, child] = entries[i];
    const keyPart = key !== null ? `${JSON.stringify(key)}: ` : '';
    const sep = i > 0 ? ', ' : '';
    const prefix = sep + keyPart;

    const flatChild = tryFlat(child, flatWidth, currentLength + acc.length + prefix.length);
    if (flatChild === null) return null;

    acc += prefix + flatChild;
  }

  acc += ` ${isArr ? ']' : '}'}`;
  return currentLength + acc.length <= flatWidth ? acc : null;
}

/** One logical unit in a container's body: the lines for one entry, or the ellipsis marker. */
type Block = string[];

/** Appends a trailing comma to every block's last line except the final block's. */
function assembleBody(blocks: Block[]): string[] {
  const out: string[] = [];
  blocks.forEach((block, i) => {
    const isLastBlock = i === blocks.length - 1;
    block.forEach((line, j) => {
      const isLastLineOfBlock = j === block.length - 1;
      out.push(isLastLineOfBlock && !isLastBlock ? `${line},` : line);
    });
  });
  return out;
}

/** Renders one entry (object `"key": value` or array element) to fully-indented lines. */
function renderEntry(
  key: string | null,
  child: JsonValue,
  budgetLines: number,
  depth: number,
  opts: ResolvedOptions,
): string[] {
  if (key === null) {
    return renderBounded(child, budgetLines, depth, opts).lines;
  }

  // The key shares the child's first line, so the child is rendered at
  // depth 0 (unindented) and the entry's own indent is prepended to every
  // line afterward — this stacks correctly since indentStr is just spaces.
  const prefix = `${JSON.stringify(key)}: `;
  const child0 = renderBounded(child, budgetLines, 0, opts);
  const [first, ...rest] = child0.lines;

  return [indentStr(depth) + prefix + first, ...rest.map((line) => indentStr(depth) + line)];
}

/** Greedily collects entries[from, to) rendered forward, stopping once the next entry would exceed budget. */
function collectForward(
  entries: Array<[string | null, JsonValue]>,
  from: number,
  to: number,
  budgetLines: number,
  depth: number,
  opts: ResolvedOptions,
): { blocks: Block[]; count: number } {
  const blocks: Block[] = [];
  let used = 0;

  for (let i = from; i < to; i++) {
    const remaining = budgetLines - used;
    if (remaining <= 0) break;

    const [key, child] = entries[i];
    const lines = renderEntry(key, child, remaining, depth, opts);
    if (lines.length > remaining) break;

    blocks.push(lines);
    used += lines.length;
  }

  return { blocks, count: blocks.length };
}

/** How many entries, walked from the end backward, fit within budgetLines (without exceeding `stopBeforeIndex`). */
function countBackward(
  entries: Array<[string | null, JsonValue]>,
  stopBeforeIndex: number,
  budgetLines: number,
  depth: number,
  opts: ResolvedOptions,
): number {
  let used = 0;
  let count = 0;

  for (let i = entries.length - 1; i >= stopBeforeIndex; i--) {
    const remaining = budgetLines - used;
    if (remaining <= 0) break;

    const [key, child] = entries[i];
    const lines = renderEntry(key, child, remaining, depth, opts);
    if (lines.length > remaining) break;

    used += lines.length;
    count++;
  }

  return count;
}

function renderBounded(value: JsonValue, budgetLines: number, depth: number, opts: ResolvedOptions): JsonPreview {
  const flat = tryFlat(value, opts.flatWidth);
  if (flat !== null) {
    return { lines: [indentStr(depth) + flat], truncated: false };
  }

  const container = value as JsonValue[] | { [key: string]: JsonValue };
  const isArr = Array.isArray(container);
  const entries = entriesOf(container);
  const openTok = isArr ? '[' : '{';
  const closeTok = isArr ? ']' : '}';

  if (entries.length === 0) {
    return { lines: [indentStr(depth) + openTok + closeTok], truncated: false };
  }

  const open = indentStr(depth) + openTok;
  const close = indentStr(depth) + closeTok;

  // Too little budget to show any real structure — collapse to a one-line summary.
  if (budgetLines < 3) {
    return {
      lines: [`${indentStr(depth)}${openTok} ⋯${entries.length}⋯ ${closeTok}`],
      truncated: true,
    };
  }

  const bodyBudget = budgetLines - 2; // minus open/close lines

  // Attempt 1: everything fits, no ellipsis needed.
  const full = collectForward(entries, 0, entries.length, bodyBudget, depth + 1, opts);
  if (full.count === entries.length) {
    return { lines: [open, ...assembleBody(full.blocks), close], truncated: false };
  }

  // Attempt 2: reserve one line for the ellipsis, split the rest head/tail.
  const remaining = Math.max(bodyBudget - 1, 0);
  const headBudget = Math.ceil(remaining / 2);
  const tailBudget = remaining - headBudget;

  const head = collectForward(entries, 0, entries.length, headBudget, depth + 1, opts);
  const tailCount = countBackward(entries, head.count, tailBudget, depth + 1, opts);
  const tail = collectForward(entries, entries.length - tailCount, entries.length, tailBudget, depth + 1, opts);

  const skipped = entries.length - head.count - tail.count;
  const ellipsis: Block = [`${indentStr(depth + 1)}⋯ ${skipped} more`];

  const blocks = [...head.blocks, ellipsis, ...tail.blocks];
  return { lines: [open, ...assembleBody(blocks), close], truncated: true };
}
