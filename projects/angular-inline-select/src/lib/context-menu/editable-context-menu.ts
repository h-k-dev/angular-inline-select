// Angular
import { inject, Injectable, Injector } from '@angular/core';
import { DOCUMENT } from '@angular/common';

// CDK
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

// Editables
import { EDITABLE_CONTEXT_MENU_CONFIG } from './editable-context-menu-config';
import { EditableContextMenuPanel } from './editable-context-menu-panel';
import {
  EDITABLE_CONTEXT_MENU_SESSION,
  type EditableContextMenuRequest,
  type EditableContextMenuSession,
} from './editable-context-menu-session';

/** A point the gesture happened at: a mouse event's, or a hover scope's forwarded one. */
function pointOf(event: Event): { x: number; y: number } | null {
  if (event instanceof MouseEvent) {
    // A keyboard-raised `contextmenu` reports no pointer.
    return event.clientX === 0 && event.clientY === 0
      ? null
      : { x: event.clientX, y: event.clientY };
  }

  const detail = (event as CustomEvent<{ clientX?: number; clientY?: number } | null>).detail;
  return typeof detail?.clientX === 'number' && typeof detail.clientY === 'number'
    ? { x: detail.clientX, y: detail.clientY }
    : null;
}

/**
 * THE editables' context menu: a right-click on a field offers Edit and Clear
 * where the pointer is. One menu for the whole page — a field holds no
 * overlay, no template and no listener state of its own for it; it only
 * calls {@link open} from its `contextmenu` handler, when its own rules say a
 * clear may be offered (not required, not locked, not empty, not editing).
 *
 * Off (`EDITABLE_CONTEXT_MENU_CONFIG`), `open` returns before doing anything.
 */
@Injectable({ providedIn: 'root' })
export class EditableContextMenu {
  #overlay = inject(Overlay);
  #injector = inject(Injector);
  #document = inject(DOCUMENT);
  #config = inject(EDITABLE_CONTEXT_MENU_CONFIG);

  #overlayRef: OverlayRef | null = null;

  /** Whether the menu answers at all — a field asks before it guards its own press. */
  get enabled(): boolean {
    return this.#config.enabled();
  }

  /**
   * Opens the menu for `event` and consumes it. Returns whether it did: `false`
   * leaves the gesture to the platform.
   */
  open(event: Event, request: EditableContextMenuRequest): boolean {
    if (!this.enabled) return false;

    event.preventDefault();
    this.#dispose();

    const point = pointOf(event);
    const box = request.anchor.getBoundingClientRect();
    const origin = point ?? { x: box.left, y: box.bottom };

    // Where focus goes back to on a dismissal; nothing held it on a pointer gesture.
    const active = this.#document.activeElement;
    const returnTo =
      active instanceof HTMLElement && active !== this.#document.body ? active : null;

    const overlayRef = this.#overlay.create({
      positionStrategy: this.#overlay
        .position()
        .flexibleConnectedTo(origin)
        .withPositions([
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
          { originX: 'start', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
          { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
        ])
        .withViewportMargin(8)
        .withPush(true),
      // The point it hangs from does not travel with the page.
      scrollStrategy: this.#overlay.scrollStrategies.close(),
      disposeOnNavigation: true,
    });
    this.#overlayRef = overlayRef;

    const session: EditableContextMenuSession = {
      request,
      byKeyboard: point === null,
      close: (action) => {
        this.#dispose();
        if (action) action();
        else returnTo?.focus({ preventScroll: true });
      },
    };

    const panel = overlayRef.attach(
      new ComponentPortal(
        EditableContextMenuPanel,
        null,
        Injector.create({
          parent: this.#injector,
          providers: [{ provide: EDITABLE_CONTEXT_MENU_SESSION, useValue: session }],
        }),
      ),
    );
    // Rendered within the gesture, then placed by its real size — the menu is
    // there in the frame that follows the press, not one render later.
    panel.changeDetectorRef.detectChanges();
    overlayRef.updatePosition();
    panel.instance.focus();

    // A press anywhere else dismisses — another field's right-click included,
    // which then opens its own.
    // The right button's own release arrives as an `auxclick` on the field —
    // after the menu opened where `contextmenu` fires on the press.
    overlayRef.outsidePointerEvents().subscribe((outside) => {
      if (outside.type !== 'auxclick') session.close();
    });
    // Subscribed so THIS overlay is the keyboard's target: without a listener
    // CDK hands Escape to the overlay beneath (a dialog would close with the menu).
    overlayRef.keydownEvents().subscribe();
    // The scroll strategy detaches on its own.
    overlayRef.detachments().subscribe(() => {
      if (this.#overlayRef === overlayRef) this.#dispose();
    });

    return true;
  }

  #dispose() {
    const overlayRef = this.#overlayRef;
    this.#overlayRef = null;
    overlayRef?.dispose();
  }
}
