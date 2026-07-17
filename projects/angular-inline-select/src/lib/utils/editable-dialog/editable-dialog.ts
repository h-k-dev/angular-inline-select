import {
  Component,
  Injectable,
  InjectionToken,
  Injector,
  Type,
  inject,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';

// CDK
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { A11yModule } from '@angular/cdk/a11y';

/**
 * The data passed to `EditableDialog.open(…, { data })` — inject it in the
 * content component exactly like MAT_DIALOG_DATA:
 *
 * ```ts
 * protected data = inject<MySessionData>(EDITABLE_DIALOG_DATA);
 * ```
 *
 * Data can carry anything — values, signals, and CALLBACKS. The house
 * pattern for editing sessions: the opener passes its accept path as a
 * `close(draft)` callback; the content component calls it on Save, and the
 * opener commits (canonicalize/serialize) and closes the ref on success.
 */
export const EDITABLE_DIALOG_DATA = new InjectionToken<unknown>('editable-dialog.data');

/** Internal: which component the container portals, and its accessible name. */
const EDITABLE_DIALOG_CONTENT = new InjectionToken<Type<unknown>>('editable-dialog.content');
const EDITABLE_DIALOG_ARIA_LABEL = new InjectionToken<string | undefined>(
  'editable-dialog.aria-label',
);

/**
 * Handle for one open dialog — injectable by the content component (like
 * MatDialogRef) and returned from `open()`.
 */
export class EditableDialogRef<R = unknown> {
  #overlayRef: OverlayRef;
  #result: R | undefined;
  #resolveClosed!: (result: R | undefined) => void;

  /**
   * Resolves exactly once when the dialog is gone — with `close(result)`'s
   * value, or `undefined` for dismissals (Escape, scrim click, navigation
   * disposal). The opener's revert safety net lives here.
   */
  readonly closed = new Promise<R | undefined>((resolve) => (this.#resolveClosed = resolve));

  constructor(overlayRef: OverlayRef) {
    this.#overlayRef = overlayRef;
    // One settlement channel for EVERY teardown path, including
    // dispose-on-navigation — never resolves twice, never leaks.
    overlayRef.detachments().subscribe(() => this.#resolveClosed(this.#result));
  }

  close(result?: R) {
    this.#result = result;
    this.#overlayRef.dispose();
  }
}

/**
 * Internal container: the dialog card chrome (focus trap, role, enter
 * animation, Escape-to-dismiss) around the portaled content component.
 * Placement is pure CSS — centered card on pointer-precise viewports,
 * full-screen on touch/narrow (_editable-dialog.scss).
 */
@Component({
  selector: 'editable-dialog-container',
  imports: [NgComponentOutlet, A11yModule],
  // The host box disappears: the CARD is the pane's direct flex item, so its
  // percentage width resolves against the pane — with a host box in between,
  // the unknown element shrink-wraps and 100% collapses to content width.
  styles: ':host { display: contents; }',
  template: `
    <div
      class="editable-dialog"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="ariaLabel ?? null"
      [animate.enter]="'editable-dialog-enter'"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="false"
      (keydown.escape)="dismiss($event)"
    >
      <ng-container *ngComponentOutlet="content" />
    </div>
  `,
})
export class EditableDialogContainer {
  protected content = inject(EDITABLE_DIALOG_CONTENT);
  protected ariaLabel = inject(EDITABLE_DIALOG_ARIA_LABEL, { optional: true }) ?? undefined;

  #ref = inject(EditableDialogRef);

  protected dismiss(event: Event) {
    event.stopPropagation();
    this.#ref.close();
  }
}

export interface EditableDialogConfig<D = unknown> {
  /** Anything the content component needs — injected via EDITABLE_DIALOG_DATA. */
  data?: D;
  /** Accessible name of the dialog. */
  ariaLabel?: string;
}

/**
 * MatDialog-shaped, house-flavored: open any component as a modal — no
 * NgModule, no template declaration, and the component type can arrive
 * lazily:
 *
 * ```ts
 * const { JsonSession } = await import('./json-session');
 * const ref = this.dialog.open<string>(JsonSession, { data: { seed, close: (draft) => … } });
 * const result = await ref.closed; // undefined on dismissal
 * ```
 *
 * The dialog owns only the modal mechanics (overlay, scrim, focus trap,
 * Escape/scrim dismissal, full-screen-on-touch layout); the opener keeps its
 * session semantics through the `data` callbacks and `ref.closed`.
 */
@Injectable({ providedIn: 'root' })
export class EditableDialog {
  #overlay = inject(Overlay);
  #injector = inject(Injector);

  open<R = unknown, D = unknown>(
    component: Type<unknown>,
    config: EditableDialogConfig<D> = {},
  ): EditableDialogRef<R> {
    const overlayRef = this.#overlay.create({
      hasBackdrop: true,
      backdropClass: 'editable-scrim',
      panelClass: 'editable-dialog-pane',
      scrollStrategy: this.#overlay.scrollStrategies.block(),
      disposeOnNavigation: true,
    });

    const ref = new EditableDialogRef<R>(overlayRef);
    overlayRef.backdropClick().subscribe(() => ref.close());

    const injector = Injector.create({
      parent: this.#injector,
      providers: [
        { provide: EditableDialogRef, useValue: ref },
        { provide: EDITABLE_DIALOG_DATA, useValue: config.data },
        { provide: EDITABLE_DIALOG_CONTENT, useValue: component },
        { provide: EDITABLE_DIALOG_ARIA_LABEL, useValue: config.ariaLabel },
      ],
    });

    overlayRef.attach(new ComponentPortal(EditableDialogContainer, null, injector));
    return ref;
  }
}
