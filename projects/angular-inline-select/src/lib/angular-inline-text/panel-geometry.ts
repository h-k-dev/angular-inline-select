// CDK
import type { ConnectedPosition, ViewportMargin } from '@angular/cdk/overlay';

/**
 * Default panel padding in px — matches the `--mat-sys-inner-spacing` fallback
 * in _editable.scss. The actual value is resolved from the token when a session
 * opens, so the lift alignment follows the consumer's spacing scale.
 */
export const PANEL_PADDING_FALLBACK = 16;

/** The gap the panel keeps to every viewport edge. */
export const PANEL_VIEWPORT_MARGIN = 16;

/**
 * The overlay's `viewportMargin` that keeps {@link PANEL_VIEWPORT_MARGIN} on
 * every side. No bottom margin, on purpose: the overlay checks a panel's bottom
 * edge (page coordinates) against the HEIGHT of the margin-narrowed viewport,
 * which already gave up the top margin — so the top margin is counted at the
 * bottom too. A bottom margin on top of it would keep a pushed full-height
 * panel twice the gap from the bottom and shove it against the top edge.
 */
export const PANEL_OVERLAY_MARGIN: ViewportMargin = {
  top: PANEL_VIEWPORT_MARGIN,
  bottom: 0,
  start: PANEL_VIEWPORT_MARGIN,
  end: PANEL_VIEWPORT_MARGIN,
};

/**
 * The panel padding a session lifts with: `--mat-sys-inner-spacing` as the
 * element resolves it (px literals only; anything else is the fallback) — the
 * same token _editable.scss derives the padding from, so the offsets stay glued.
 */
export function resolvePanelPadding(element: HTMLElement): number {
  const raw = getComputedStyle(element).getPropertyValue('--mat-sys-inner-spacing').trim();
  const px = raw.endsWith('px') ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(px) && px >= 0 ? px : PANEL_PADDING_FALLBACK;
}

/**
 * The elevated panel's positions: preferred is "over" (the panel's text covers
 * the origin text — the offsets cancel the panel padding so its first line
 * sits optically on the origin text), falling back below, then above the
 * field. `push: true` keeps the panel inside the viewport margins in all cases.
 */
export function panelPositions(paddingX: number): ConnectedPosition[] {
  return [
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'top',
      offsetX: -paddingX,
      offsetY: -(paddingX * 0.75 + 1), // vertical padding is 0.75 × inner spacing, +1 border
    },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
  ];
}

/**
 * The panel's size limit for a session: the viewport less a margin on each
 * side. Fixed when the session opens and never derived from where the panel
 * lands — the panel takes its size first (its draft, up to this) and the
 * overlay only positions that box. Anything this tall still fits on screen, so
 * a push can always bring it fully into view. `null` (no limit) when there is
 * no room to measure — a zero-height viewport must not collapse the panel.
 */
export function panelHeightLimit(
  viewportHeight: number,
  margin = PANEL_VIEWPORT_MARGIN,
): number | null {
  const room = Math.floor(viewportHeight - 2 * margin);
  return room > 0 ? room : null;
}

/**
 * Whether the placed panel crossed a viewport margin — the only time it is
 * re-positioned. A panel that grew past the bottom (or top) moves; one that
 * still fits stays where it is, so typing never makes it jump.
 */
export function panelOverflows(
  pane: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number,
  margin = PANEL_VIEWPORT_MARGIN,
): boolean {
  // Whole pixels: a subpixel-placed pane must not count as crossing its own margin.
  return Math.round(pane.top) < margin || Math.round(pane.bottom) > viewportHeight - margin;
}
