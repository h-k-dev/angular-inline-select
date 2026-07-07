import { InjectionToken, signal, type Provider, type Signal } from '@angular/core';

import type { ZoneId } from './db-entry';

/**
 * T6 — the app-wide DISPLAY ZONE default (iusta's
 * `ServerSideDatetimeConfiguration` analogue): every temporal control and
 * the range group read it as the fallback behind their own `zone` input.
 * Absent, wall-clocks and calendar days read in the MACHINE zone — the
 * pre-T6 behavior.
 *
 * A `Signal` on purpose: a server-pushed configuration change re-renders
 * every display without touching a single value — values are UTC DB
 * entries and never contain the zone.
 */
export const INLINE_TEMPORAL_ZONE = new InjectionToken<Signal<ZoneId>>('INLINE_TEMPORAL_ZONE');

/** `provideInlineTemporalZone('Europe/Berlin')` — or hand in a live signal. */
export function provideInlineTemporalZone(zone: string | Signal<ZoneId>): Provider {
  return {
    provide: INLINE_TEMPORAL_ZONE,
    useValue: typeof zone === 'string' ? signal<ZoneId>(zone).asReadonly() : zone,
  };
}
