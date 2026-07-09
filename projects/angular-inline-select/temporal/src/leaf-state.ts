import { InjectionToken, type Signal } from '@angular/core';
import type { ValidationError } from '@angular/forms/signals';
import type { BubbleMenuSide } from 'angular-inline-select';

/**
 * Contract state a field-bound range group forwards DOWN to its leaves —
 * provided per-leaf by the role directives (the day-offset pattern), so a
 * standalone control never sees it and stays fully decoupled. Leaves MERGE
 * these with their own inputs via computeds: no effects, no writes, pure
 * pull.
 */
export interface TemporalLeafState {
  disabled: Signal<boolean>;
  readonly: Signal<boolean>;
  touched: Signal<boolean>;
  invalid: Signal<boolean>;
  /** Group-level errors routed to THIS leaf (ordering errors → the end field). */
  errors: Signal<readonly ValidationError.WithOptionalFieldTree[]>;
}

export const INLINE_TEMPORAL_LEAF_STATE = new InjectionToken<TemporalLeafState>(
  'INLINE_TEMPORAL_LEAF_STATE',
);

/**
 * The clear-bubble side a leaf ROLE dictates (the day-offset pattern): the
 * pair's inline-START leaves (`rangeDay`, `rangeStart`) provide `'start'`
 * so their bubbles open OUTWARD without every consumer hand-wiring
 * `clearBubbleSide="start"`. The control's own input, when set, overrides.
 */
export const INLINE_TEMPORAL_BUBBLE_SIDE = new InjectionToken<BubbleMenuSide>(
  'INLINE_TEMPORAL_BUBBLE_SIDE',
);
