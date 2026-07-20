/*
 * Public API Surface of angular-inline-select/temporal
 *
 * Secondary entry point: apps that never import it carry zero
 * date/time/duration bytes — the core barrel stays temporal-free.
 */

export * from './datetime/db-entry';
export * from './datetime/zone';
export * from './leaf-state';
export * from './temporal-intl';
export * from './angular-inline-date/angular-inline-date';
export * from './angular-inline-date/date-codec';
export * from './angular-inline-date/calendar/calendar';
export * from './angular-inline-time/angular-inline-time';
export * from './angular-inline-time/time-codec';
export * from './angular-inline-time/day-offset';
export * from './angular-inline-duration/angular-inline-duration';
export * from './angular-inline-duration/duration-codec';
export * from './range-group/range-group';
