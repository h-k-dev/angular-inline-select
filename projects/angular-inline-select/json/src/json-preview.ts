import {
  prepareWithSegments,
  layoutNextLineRange,
  materializeLineRange,
  measureNaturalWidth,
  type LayoutCursor,
} from '@chenglou/pretext';

/**
 * The idle preview is PARAGRAPH TEXT: the compact JSON string flows inline
 * exactly like the surrounding copy (that is the whole point of "inline"),
 * wraps at whatever width the container currently has, and — when it would
 * exceed the visual-line budget — ellipses IN THE MIDDLE with real head and
 * real tail content.
 *
 * "Visual line" is the operative word: the budget is measured against the
 * rendered layout (font, container width, the mid-paragraph start of the
 * first line), not against any pre-formatted line structure. The measurement
 * runs on @chenglou/pretext — canvas-metric text layout, zero DOM reflow —
 * so a multi-megabyte value costs a bounded head/tail slice of measurement,
 * never a full render.
 */

export const PREVIEW_ELLIPSIS = ' ⋯';

/** The geometry of the paragraph slot the preview renders into. */
export interface InlinePreviewGeometry {
  /** Width remaining on the line the preview STARTS on (it begins mid-paragraph). */
  firstLineWidth: number;
  /** Full content width of the containing block — every following line. */
  lineWidth: number;
  /** Canvas font shorthand of the rendered text, e.g. `400 16px Roboto`. */
  font: string;
  /** Letter spacing in px, when the computed style carries one. */
  letterSpacing?: number;
}

const ORIGIN: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };

/**
 * How many rendered lines `prepared` occupies with a distinct first-line
 * width, stopping early once the count exceeds `limit` (never walks a huge
 * text past the budget).
 */
function countLines(
  prepared: ReturnType<typeof prepareWithSegments>,
  geometry: InlinePreviewGeometry,
  limit: number,
): number {
  let cursor = ORIGIN;
  let count = 0;

  while (count <= limit) {
    const width = count === 0 ? Math.max(geometry.firstLineWidth, 24) : geometry.lineWidth;
    const range = layoutNextLineRange(prepared, cursor, width);
    if (range === null) return count;

    cursor = range.end;
    count++;
  }

  return count; // limit + 1 — enough to know it does not fit
}

/**
 * Middle-ellipsis truncation measured in VISUAL lines.
 *
 * Layout plan for a budget of N lines (N ≥ 2):
 * - head: lines 1..⌈N/2⌉ — line 1 at the partial first-line width, the last
 *   head line reserving the ellipsis width so " ⋯" lands on it;
 * - a hard break after the ellipsis;
 * - tail: the LAST ⌊N/2⌋ rendered lines of the value at full width. Greedy
 *   wrapping is memoryless from a line start, so the final line-range starts
 *   of the tail slice are exactly the final rendered lines of the full text.
 *
 * Head and tail measure bounded SLICES sized from a probe of the actual
 * font's average character width — the middle of a huge value is never
 * prepared, measured, or materialized.
 */
export function truncateToVisualLines(
  text: string,
  maxLines: number,
  geometry: InlinePreviewGeometry,
): string {
  const options = { whiteSpace: 'pre-wrap' as const, letterSpacing: geometry.letterSpacing };
  const budget = Math.max(maxLines, 2);

  // Probe the font: average character width over a JSON-typical sample.
  const probeText = '{"abcdefgh": 12345, "x": true},';
  const probe = prepareWithSegments(probeText, geometry.font, options);
  const averageCharWidth = Math.max(measureNaturalWidth(probe) / probeText.length, 1);
  const charsPerLine = Math.max(Math.ceil(geometry.lineWidth / averageCharWidth), 8);

  // Fits check on a bounded prefix: only a text short enough to possibly fit
  // is ever fully measured.
  const fitBudgetChars = charsPerLine * (budget + 1) * 2;
  if (text.length <= fitBudgetChars) {
    const whole = prepareWithSegments(text, geometry.font, options);
    if (countLines(whole, geometry, budget) <= budget) return text;
  }

  const headLines = Math.ceil(budget / 2);
  const tailLines = budget - headLines;

  const ellipsis = prepareWithSegments(PREVIEW_ELLIPSIS, geometry.font, options);
  const ellipsisWidth = measureNaturalWidth(ellipsis);

  // HEAD — walk exactly headLines ranges with per-line widths.
  const headSlice = text.slice(0, charsPerLine * (headLines + 1) * 2);
  const headPrepared = prepareWithSegments(headSlice, geometry.font, options);

  let head = '';
  let cursor = ORIGIN;
  for (let i = 0; i < headLines; i++) {
    const width =
      i === 0
        ? Math.max(geometry.firstLineWidth, 24)
        : i === headLines - 1
          ? Math.max(geometry.lineWidth - ellipsisWidth, 24)
          : geometry.lineWidth;

    const range = layoutNextLineRange(headPrepared, cursor, width);
    if (range === null) break;

    head += materializeLineRange(headPrepared, range).text;
    cursor = range.end;
  }

  // TAIL — the last tailLines rendered lines of the value at full width.
  const tailSlice = text.slice(-(charsPerLine * (tailLines + 1) * 2));
  const tailPrepared = prepareWithSegments(tailSlice, geometry.font, options);

  const tailLineTexts: string[] = [];
  let tailCursor = ORIGIN;
  for (;;) {
    const range = layoutNextLineRange(tailPrepared, tailCursor, geometry.lineWidth);
    if (range === null) break;

    tailLineTexts.push(materializeLineRange(tailPrepared, range).text);
    tailCursor = range.end;
  }

  const tail = tailLineTexts.slice(-Math.max(tailLines, 1)).join('');

  return `${head}${PREVIEW_ELLIPSIS}\n${tail}`;
}

/**
 * Measurement-free fallback (SSR, jsdom, a not-yet-laid-out container): a
 * character-budget middle ellipsis. Same shape, coarser cut — the rendered
 * result is refined by `truncateToVisualLines` as soon as geometry exists.
 */
export function fallbackTruncate(text: string, maxLines: number, charsPerLine = 80): string {
  const budget = Math.max(maxLines, 2) * charsPerLine;
  if (text.length <= budget) return text;

  const headChars = Math.ceil(budget * 0.6);
  const tailChars = budget - headChars;
  return `${text.slice(0, headChars)}${PREVIEW_ELLIPSIS}\n${text.slice(-tailChars)}`;
}
