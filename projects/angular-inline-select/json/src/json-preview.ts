import {
  MIDDLE_ELLIPSIS,
  fallbackTruncate,
  truncateToVisualLines as truncateInlineFlow,
  type InlineFlowGeometry,
} from 'angular-inline-select';

/**
 * The JSON preview is the shared middle-ellipsis core (see
 * utils/middle-ellipsis in the main entry point) flavored for JSON:
 * `line-break: anywhere` rendering (code-like content packs every line
 * full — mirrored in the measurement) and a JSON-typical font probe.
 */

export const PREVIEW_ELLIPSIS = MIDDLE_ELLIPSIS;

export type InlinePreviewGeometry = InlineFlowGeometry;

/** Sizes the bounded measuring slices from a JSON-typical character mix. */
const JSON_PROBE_TEXT = '{"abcdefgh": 12345, "x": true},';

/** Middle-ellipsis truncation measured in VISUAL lines — JSON flavor. */
export function truncateToVisualLines(
  text: string,
  maxLines: number,
  geometry: InlinePreviewGeometry,
): string {
  return truncateInlineFlow(text, maxLines, geometry, {
    breakAnywhere: true, // pairs with `line-break: anywhere` in _editable-json.scss
    probeText: JSON_PROBE_TEXT,
  });
}

export { fallbackTruncate };
