// Angular
import {
  InjectionToken,

  // Signals
  type Signal,
} from '@angular/core';

// Datetime
import type { IsoDate } from './datetime/iso-date';

/**
 * A DAY CALENDAR a directive lends the date control it sits on — the
 * element-level twin of the `dayFilter` input, for a calendar the host
 * application owns (a firm's working days: weekends plus configured
 * holidays). Provided on the control's own element and injected `self`-only,
 * like the range group's leaf state; the input still wins when bound.
 *
 * Why a day is unavailable is the consumer's to say — its schema error,
 * under the field (mat-error) — never a notice inside the picker.
 *
 * A signal of a function, so a calendar that loads late (holidays fetched
 * from a server) re-renders the grid the moment it arrives. `undefined`
 * offers nothing — an off switch stays a plain `undefined`.
 */
export interface InlineDayAvailability {
  /** `false` disables a day in the calendar and the quick picks. */
  readonly filter: Signal<((iso: IsoDate) => boolean) | undefined>;
}

export const INLINE_DAY_AVAILABILITY = new InjectionToken<InlineDayAvailability>(
  'INLINE_DAY_AVAILABILITY',
);
