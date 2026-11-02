import { Directive } from '@angular/core';

/**
 * THE way an overlay panel leaves — a menu, a select's listbox, an editable's
 * panel. After Linear's menus: it settles (scale 1 → 0.98 in ~40ms) and fades
 * over the theme's transition duration, so a close reads as the panel letting
 * go rather than flying off.
 *
 * Put it on the panel's ROOT element inside the overlay template:
 *
 * ```html
 * <ng-template cdkConnectedOverlay …>
 *   <div ngMenu overlayLeave …>…</div>
 * </ng-template>
 * ```
 *
 * No script runs the motion: Angular's `animate.leave` adds the class and
 * keeps the element in the DOM until its CSS animation ends. The look is the
 * global `.overlay-leave` (`_overlay-leave.scss`) — also where the panel stops
 * taking the pointer, so a click aimed at what lies under a leaving panel
 * lands there.
 *
 * Leave only: an enter stays the panel's own (`animate.enter`).
 */
@Directive({
  selector: '[overlayLeave]',
  host: {
    'animate.leave': 'overlay-leave',
  },
})
export class OverlayLeave {}
