import { InjectionToken, type ElementRef, type Signal, type WritableSignal } from '@angular/core';

/**
 * The signal surface a form-field adapter (the `inlineMatFormField`
 * directive) leans on — nothing beyond what the temporal controls ALREADY
 * expose as `FormValueControl`s plus their public presentational verdicts.
 * The CONTROLS stay entirely mat-ignorant: each provides this token on
 * itself (`useExisting`); every piece of Material knowledge lives in the
 * adapter. Material-free on purpose — this file ships with the base
 * temporal controls, the adapter with its own Material-aware entry point.
 */
export interface InlineTemporalMatControl {
  value: Signal<unknown>;
  /** Whether an edit session is open (= focus is within). */
  editing: Signal<boolean>;
  isEmpty: Signal<boolean>;
  required: Signal<boolean>;
  effectiveDisabled: Signal<boolean>;
  /** The field's own "errors show now" verdict — becomes mat's errorState. */
  errorsVisible: Signal<boolean>;
  /** The effective placeholder text (per-format defaults resolved). */
  placeholderText: Signal<string>;
  /** Whether the panel (calendar / error overlay) is showing. */
  panelVisible: Signal<boolean>;
  /** Toggle the panel like the control's own trigger. */
  togglePanel(): void;
  /**
   * Present on controls with their own ERROR overlay (time, duration): the
   * adapter sets it inside a form field, whose error area speaks instead.
   * The date's panel is its calendar, so the date omits it.
   */
  externalErrors?: WritableSignal<boolean>;
  focus(options?: FocusOptions): void;
  /**
   * Present on controls that float a panel (the date's calendar): the
   * adapter hands the form field's connected-overlay origin through it so
   * the panel drops below the box's underline. CDK-generic — the control
   * never learns what hosts it; controls without a panel simply omit it.
   */
  overlayOrigin?: { set(origin: ElementRef<HTMLElement> | HTMLElement | null): void };
}

/** Provided by every temporal control on itself (`useExisting`) — the adapter's one way in. */
export const INLINE_TEMPORAL_MAT_CONTROL = new InjectionToken<InlineTemporalMatControl>(
  'INLINE_TEMPORAL_MAT_CONTROL',
);
