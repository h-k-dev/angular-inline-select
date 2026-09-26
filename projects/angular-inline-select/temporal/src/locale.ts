// Angular
import {
  InjectionToken,
  type Provider,

  // Signals
  signal,
  type Signal,
} from '@angular/core';

/** A BCP 47 locale (or a preference list); `undefined` = the browser's. */
export type TemporalLocale = string | string[] | undefined;

/**
 * The app-wide LOCALE default: every temporal control reads it as the
 * fallback behind its own `locale` input — dates, wall clocks and the
 * calendar localize through `Intl` in it. Absent, the browser's locale.
 *
 * A `Signal` on purpose: wire the app's language through here and a runtime
 * language switch re-renders every display.
 */
export const INLINE_TEMPORAL_LOCALE = new InjectionToken<Signal<TemporalLocale>>(
  'INLINE_TEMPORAL_LOCALE',
);

/** `provideInlineTemporalLocale('de-DE')` — or hand in a live signal. */
export function provideInlineTemporalLocale(locale: string | Signal<TemporalLocale>): Provider {
  return {
    provide: INLINE_TEMPORAL_LOCALE,
    useValue: typeof locale === 'string' ? signal<TemporalLocale>(locale).asReadonly() : locale,
  };
}
