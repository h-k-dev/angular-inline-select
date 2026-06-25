import {
  Directive,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  inject,
  InjectionToken,
  Injector,
  Signal,

  // Signals
  computed,
  input,
  model,
} from '@angular/core';
import { CdkConnectedOverlay, ConnectedPosition, CdkConnectedOverlayConfig, Overlay } from '@angular/cdk/overlay';

/**
 * These offsets are in line with the ones appearing in the editable styles.
 * There these sizes are relative to rem but here we eye balled them to be 1rem = 13px font size.
 */
export const VISUAL_Y_OFFSET = 7.5;
export const VISUAL_X_OFFSET = 9;

export const VISUAL_X_OFFSET_OUTLINE = 9.75;
export const VISUAL_Y_OFFSET_OUTLINE = 9.5;

export const OVERLAY_POSITIONS: ConnectedPosition[] = [
  {
    originX: 'start',
    originY: 'bottom',
    overlayX: 'start',
    overlayY: 'top',
    offsetY: VISUAL_Y_OFFSET,
    offsetX: -VISUAL_X_OFFSET,
    panelClass: ['__bottom'],
  },
  {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetY: -VISUAL_Y_OFFSET,
    offsetX: -VISUAL_X_OFFSET,
    panelClass: ['__top'],
  },
];

export const OVERLAY_POSITIONS_OUTLINE: ConnectedPosition[] = [
  {
    originX: 'start',
    originY: 'bottom',
    overlayX: 'start',
    overlayY: 'top',
    offsetY: VISUAL_Y_OFFSET_OUTLINE,
    offsetX: -VISUAL_X_OFFSET_OUTLINE,
    panelClass: ['__bottom'],
  },
  {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetY: -VISUAL_Y_OFFSET_OUTLINE,
    offsetX: -VISUAL_X_OFFSET_OUTLINE,
    panelClass: ['__top'],
  },
];

/**
 * Appearance type for editable components.
 */
export type EditableAppearance = 'outline' | 'fill';

/**
 * Default appearance value. Components using this directive should use this
 * as their input default to maintain consistency.
 */
export const DEFAULT_EDITABLE_APPEARANCE: EditableAppearance = 'fill';

/**
 * Configuration interface for host directive usage.
 * Components can provide this to configure the directive via DI
 * instead of template inputs.
 */
export interface OverlayWidthSyncContext {
  /** Signal indicating whether the overlay is open */
  isOpen: Signal<boolean>;
  /** Signal for the appearance style */
  appearance: Signal<EditableAppearance>;
  /** Signal for the element to measure width from */
  originElement: Signal<HTMLElement | undefined>;
  /** Optional signal for width offset override */
  widthOffsetOverride?: Signal<number | undefined>;
  /** Function to manually trigger overlay repositioning */
  connectedOverlay?: Signal<CdkConnectedOverlay | undefined>;
}

export const DEFAULT_CDK_CONNECTED_OVERLAY_CONFIG: CdkConnectedOverlayConfig = {
  viewportMargin: 8,
  push: true,
  disposeOnNavigation: true,
} as const;

/**
 * Injection token for host directive configuration.
 * Components using the directive as a hostDirective should provide this.
 */
export const OVERLAY_WIDTH_SYNC_CONTEXT = new InjectionToken<OverlayWidthSyncContext>('OVERLAY_WIDTH_SYNC_CONTEXT');

/**
 * Directive that automatically syncs an overlay's minimum width with its origin element
 * and handles repositioning when the origin resizes.
 *
 * It also provides computed overlay positions and width offsets based on the appearance.
 */
@Directive({
  selector: '[mOverlayWidthSync]',
  exportAs: 'overlayWidthSync',
})
export class OverlayWidthSyncDirective implements AfterViewInit, OnDestroy {
  #overlay = inject(Overlay);
  #elementRef = inject(ElementRef);
  #injector = inject(Injector);

  scrollStrategy = computed(() => this.#overlay.scrollStrategies.block());

  /**
   * Lazily resolved context for host directive usage.
   * Uses Injector.get() to avoid circular dependency during construction.
   */
  #contextCache: OverlayWidthSyncContext | null | undefined = undefined;

  #getContext(): OverlayWidthSyncContext | null {
    if (this.#contextCache === undefined) {
      this.#contextCache = this.#injector.get(OVERLAY_WIDTH_SYNC_CONTEXT, null, { optional: true });
    }

    return this.#contextCache;
  }

  defaultConfig = DEFAULT_CDK_CONNECTED_OVERLAY_CONFIG;

  // ---------------------------------------------------------------------------
  // Inputs (used when no context is provided)
  // ---------------------------------------------------------------------------

  /**
   * The visual appearance style. Determines default positions and offsets.
   * - 'fill': Default style with standard offsets
   * - 'outline': Outline style with slightly larger offsets
   */
  appearanceInput = input<EditableAppearance>(DEFAULT_EDITABLE_APPEARANCE, { alias: 'appearance' });

  /**
   * Optional override for the width offset.
   * If not provided, automatically calculated based on appearance.
   */
  widthOffsetOverrideInput = input<number | undefined>(undefined, { alias: 'widthOffsetOverride' });

  /**
   * Whether the overlay is currently open (used to conditionally apply width)
   */
  isOpenInput = input<boolean>(false, { alias: 'isOpen' });

  minWidth = input<number>(250, { alias: 'widthSyncMin' });

  /**
   * Optional element to measure width from.
   * If not provided, measures the host element.
   */
  originElementInput = input<HTMLElement | undefined>(undefined, { alias: 'originElement' });

  /**
   * The measured width of the element
   */
  measuredWidth = model(0);

  // ---------------------------------------------------------------------------
  // Resolved values (prefer context over inputs)
  // ---------------------------------------------------------------------------

  /** Resolved isOpen - prefers context over input */
  #isOpen = computed(() => this.#getContext()?.isOpen() ?? this.isOpenInput());

  /** Resolved appearance - prefers context over input */
  #appearance = computed(() => this.#getContext()?.appearance() ?? this.appearanceInput());

  /** Resolved originElement - prefers context over input */
  #originElement = computed(() => this.#getContext()?.originElement() ?? this.originElementInput());

  /** Resolved widthOffsetOverride - prefers context over input */
  #widthOffsetOverride = computed(() => this.#getContext()?.widthOffsetOverride?.() ?? this.widthOffsetOverrideInput());

  // ---------------------------------------------------------------------------
  // Computed values based on appearance
  // ---------------------------------------------------------------------------

  /**
   * The width offset based on appearance (or explicit override)
   */
  widthOffset = computed(() => {
    const override = this.#widthOffsetOverride();
    if (override !== undefined) return override;

    const offset = this.#appearance() === 'outline' ? VISUAL_X_OFFSET_OUTLINE : VISUAL_X_OFFSET;
    return offset * 2;
  });

  /**
   * The computed width including any offsets
   */
  overlayWidth = computed(() => Math.max(this.measuredWidth() + this.widthOffset(), this.minWidth()));

  /**
   * The overlay positions based on appearance.
   */
  overlayPositions = computed((): ConnectedPosition[] => {
    if (this.#appearance() === 'outline') {
      return OVERLAY_POSITIONS_OUTLINE;
    }

    return OVERLAY_POSITIONS;
  });

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  #resizeObserver?: ResizeObserver;
  #rafId: number | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngAfterViewInit() {
    const element = this.#originElement() ?? this.#elementRef.nativeElement;

    // Initialize with current width
    this.measuredWidth.set(element.getBoundingClientRect().width);

    // Watch for size changes
    this.#resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // Use contentRect to avoid layout thrashing
      this.measuredWidth.set(entry.contentRect.width);

      // Trigger overlay reposition if needed
      this.#scheduleOverlayReposition();
    });

    this.#resizeObserver.observe(element);
  }

  ngOnDestroy() {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;

    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  private connectedOverlay = computed(() => this.#getContext()?.connectedOverlay?.());

  /**
   * Throttled overlay reposition using requestAnimationFrame
   */
  #scheduleOverlayReposition() {
    if (!this.#isOpen()) return;

    const overlay = this.connectedOverlay();
    if (!overlay?.overlayRef) return;

    if (this.#rafId !== null) return;

    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;

      overlay.overlayRef?.updatePosition();
    });
  }

  /**
   * Public method to manually trigger overlay repositioning
   */
  updateOverlayPosition() {
    this.#scheduleOverlayReposition();
  }
}
