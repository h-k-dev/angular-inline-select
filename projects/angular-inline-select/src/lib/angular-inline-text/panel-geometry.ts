// CDK
import type { ConnectedPosition } from '@angular/cdk/overlay';

/**
 * Default panel padding in px — matches the `--mat-sys-inner-spacing` fallback
 * in _editable.scss. The actual value is resolved from the token when a session
 * opens, so the lift alignment follows the consumer's spacing scale.
 */
export const PANEL_PADDING_FALLBACK = 16;

/** The gap the panel keeps to the viewport edges: the overlay's `viewportMargin`, and the ceiling's. */
export const PANEL_VIEWPORT_MARGIN = 16;

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
 * The tallest the panel may grow from where the overlay placed it: from its
 * anchored edge to the far viewport margin — a panel hanging from its top grows
 * down, one standing on its bottom grows up. Read from the PLACED pane, so it
 * holds whether the overlay fitted the panel or pushed it on screen (a push
 * gives up the overlay's own flexible sizing).
 */
export function panelCeiling(
  pane: Pick<DOMRect, 'top' | 'bottom'>,
  overlayY: ConnectedPosition['overlayY'],
  viewportHeight: number,
  margin = PANEL_VIEWPORT_MARGIN,
): number {
  const room = overlayY === 'bottom' ? pane.bottom - margin : viewportHeight - margin - pane.top;

  return Math.max(0, Math.floor(room));
}
