import { InjectionToken, type Signal } from '@angular/core';

/**
 * Day-overflow feed for the time control's `+n` badge (the airline
 * arrival-time pattern): when provided on the control's element — the
 * range group's `rangeEnd` role directive does this — the control renders
 * a `+1`-style suffix badge whenever the signal is positive.
 *
 * Presentation-only by design: the offset is DERIVED state (from the
 * group's composed datetimes), never part of the draft or the `'HH:mm'`
 * value.
 */
export const INLINE_TIME_DAY_OFFSET = new InjectionToken<Signal<number>>(
  'INLINE_TIME_DAY_OFFSET',
);
