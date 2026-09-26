import { InjectionToken, type Signal } from '@angular/core';

import type { IsoDate } from './datetime/iso-date';

/**
 * A DAY CALENDAR a directive lends the date control it sits on — the
 * element-level twin of the `dayFilter` / `dayFilterReason` /
 * `dayFilterSuggestion` inputs, for a calendar the host application owns (a
 * firm's working days: weekends plus configured holidays). Provided on the
 * control's own element and injected `self`-only, like the range group's
 * leaf state; the inputs still win when bound.
 *
 * Signals of functions, so a calendar that loads late (holidays fetched
 * from a server) re-renders the grid the moment it arrives. `undefined`
 * members offer nothing — an off switch stays a plain `undefined`.
 */
export interface InlineDayAvailability {
  /** `false` disables a day in the calendar and the quick picks. */
  readonly filter: Signal<((iso: IsoDate) => boolean) | undefined>;
  /** Why an unavailable day is unavailable (a holiday's name); `null` for no reason worth naming. */
  readonly reason: Signal<((iso: IsoDate) => string | null) | undefined>;
  /** The nearest available day to offer instead. */
  readonly suggestion: Signal<((iso: IsoDate) => IsoDate | null) | undefined>;
}

export const INLINE_DAY_AVAILABILITY = new InjectionToken<InlineDayAvailability>(
  'INLINE_DAY_AVAILABILITY',
);
