import {
  Component,
  ElementRef,
  inject,

  // Signals
  computed,
  output,
  contentChild,
  viewChild,
  input,
  Signal,
} from '@angular/core';
import { CdkConnectedOverlay, CdkConnectedOverlayConfig, OverlayModule } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { A11yModule } from '@angular/cdk/a11y';

import { EditableOverlayControl } from '../directives/editable-overlay-control';
import { EditableActionButtons } from '../editable-action-buttons/editable-action-buttons';
import {
  DEFAULT_EDITABLE_APPEARANCE,
  EditableAppearance,
  OverlayWidthSyncContext,
  OverlayWidthSyncDirective,
  OVERLAY_WIDTH_SYNC_CONTEXT,
} from '../directives/overlay-width-sync';

@Component({
  selector: 'm-editable-wrapper',
  imports: [
    // CDK
    OverlayModule,
    A11yModule,

    // Material
    MatButtonModule,
    MatIconModule,

    // Components
    EditableActionButtons,
  ],
  hostDirectives: [OverlayWidthSyncDirective],
  providers: [
    {
      provide: OVERLAY_WIDTH_SYNC_CONTEXT,
      useExisting: EditableWrapper,
    },
  ],
  templateUrl: './editable-wrapper.html',
  styleUrl: './editable-wrapper.scss',
  host: {
    class: 'iusta-editable-wrapper',
    '[class]': 'customClass()',
    '[class.iusta-editable-wrapper--has-prefix]': 'hasPrefix()',
    '[class.iusta-editable-wrapper--outline]': 'appearance() === "outline"',
    '[class.invalid]': 'isInvalid()',
    '[class.is-editing]': 'isOpen()',

    '(keydown.control.enter)': 'handleAccept()',
    '(keydown.escape)': 'handleDecline()',
    '(keydown.tab)': 'handleTab($event)',
    '(keydown.shift.tab)': 'handleTab($event)',
  },
})
export class EditableWrapper implements OverlayWidthSyncContext {
  widthOffsetOverride?: Signal<number | undefined> | undefined;
  // ---------------------------------------------------------------------------
  // Host directive
  // ---------------------------------------------------------------------------
  private widthSync = inject(OverlayWidthSyncDirective);

  // ---------------------------------------------------------------------------
  // Content + View refs
  // ---------------------------------------------------------------------------
  wrapperRef = inject(ElementRef<HTMLElement>);
  connectedOverlay = viewChild(CdkConnectedOverlay);
  protected overlayControl = contentChild.required(EditableOverlayControl);
  protected panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------
  appearance = input<EditableAppearance>(DEFAULT_EDITABLE_APPEARANCE);
  hasPrefix = input<boolean>(false);
  customClass = input<string>('');

  // ---------------------------------------------------------------------------
  // Derived state (signals)
  // ---------------------------------------------------------------------------
  protected inputElement = computed(() => this.overlayControl().host);
  protected control = computed(() => this.overlayControl().state());
  protected isInvalid = computed(() => this.control().invalid());
  protected isDirty = computed(() => this.control().dirty());
  protected currentValue = computed(() => this.overlayControl().currentValue());
  protected warningMessage = computed(() => this.overlayControl().warningMessage());

  /**
   * Only open if the input is active AND it needs attention (dirty or invalid).
   * Part of OverlayWidthSyncContext interface.
   */
  isOpen = computed(() => {
    const active = this.overlayControl().isOpen();
    const needsAttention = this.isDirty() || this.isInvalid();
    return active && needsAttention;
  });

  /**
   * The element to measure width from.
   * Part of OverlayWidthSyncContext interface.
   */
  originElement = computed(() => this.wrapperRef.nativeElement);

  // ---------------------------------------------------------------------------
  // Width measurement
  // ---------------------------------------------------------------------------

  protected overlayConfig = computed(
    (): CdkConnectedOverlayConfig => ({
      origin: this.wrapperRef,
      panelClass: 'iusta-editable-panel',
      width: this.width(),
      positions: this.widthSync.overlayPositions(),
      minWidth: '300px',
      usePopover: 'inline',
    }),
  );

  width = computed(() => this.widthSync.overlayWidth());

  /** Expose overlay positions for child components that need it */
  overlayPositions = computed(() => this.widthSync.overlayPositions());

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  protected errorMessage = computed(() => {
    const errors = this.control().errors();
    return errors ? 'Invalid input' : null;
  });

  protected panelMessage = computed((): { text: string; kind: 'error' | 'hint' } | null => {
    if (this.isInvalid()) {
      return { text: this.errorMessage() ?? 'Invalid input', kind: 'error' };
    }

    if (this.isDirty()) {
      return { text: 'You have unsaved changes', kind: 'hint' };
    }

    return null;
  });

  // ---------------------------------------------------------------------------
  // Outputs
  // ---------------------------------------------------------------------------
  accepted = output<void>();
  declined = output<void>();
  detached = output<void>();
  attached = output<void>();
  copied = output<void>();

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  protected handleAccept() {
    if (this.isInvalid()) return;
    this.accepted.emit();
  }

  protected handleDecline() {
    this.declined.emit();
  }

  protected handleDetach() {
    this.detached.emit();
  }

  protected handleAttach() {
    this.attached.emit();
    this.widthSync.updateOverlayPosition();
  }

  // ---------------------------------------------------------------------------
  // Focus + close helpers
  // ---------------------------------------------------------------------------
  private focusOrigin() {
    this.control().focusBoundControl();
    this.widthSync.updateOverlayPosition();
  }

  // ---------------------------------------------------------------------------
  // Keyboard Navigation
  // ---------------------------------------------------------------------------

  /**
   * Handles outside clicks while the field has unsaved changes.
   * Blocks switching to other editables, allows clicks inside the current one,
   * declines the edit on clearly distant clicks, and otherwise keeps focus
   * on the current field to prevent accidental data loss.
   */
  protected handleOutsideClick(event: MouseEvent) {
    if (!this.isDirty()) return;

    const originEl = this.wrapperRef.nativeElement;
    const targetEl = event.target as HTMLElement | null;
    if (!targetEl) return;

    // Dirty → distance gate (squared Euclidean)
    const rect = originEl.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;

    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;

    const threshold = Math.ceil(window.innerHeight / 2);
    const thresholdSq = threshold * threshold;

    // Far away → explicit decline
    if (dx * dx + dy * dy > thresholdSq) {
      this.handleDecline();
      return;
    }
  }

  protected handleBackdropClick() {
    if (!this.isDirty()) return;
    this.focusOrigin();
  }

  /*
   * Handles tab key presses while the field has unsaved changes.
   * Prevents leaving the field and instead moves focus into the overlay panel.
   */
  protected handleTab(event: Event) {
    if (!this.isDirty()) return;

    // Dirty: don't allow leaving; instead move focus into the overlay panel.
    event.preventDefault();

    queueMicrotask(() => {
      const panelEl = this.panelRef()?.nativeElement;
      if (!panelEl) return;

      const firstFocusable = panelEl.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      firstFocusable?.focus();
    });
  }

  updateOverlayPosition() {
    this.widthSync.updateOverlayPosition();
  }
}
