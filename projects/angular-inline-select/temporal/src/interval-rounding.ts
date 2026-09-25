/**
 * How a settled length lands on the `intervalStep` grid.
 *
 * - `'ceil'` (the default) — up to the next multiple: billed time never
 *   under-reports (a 16-minute call on a 15-minute grid bills 30).
 * - `'round'` — to the NEAREST multiple.
 * - `'floor'` — down to the previous multiple.
 *
 * Rounding is a business rule on the SETTLED value, not input granularity:
 * the native picker's `step` (which values it offers) is a separate knob.
 */
export type IntervalRounding = 'ceil' | 'round' | 'floor';

/** Rounds `seconds` onto the `step` grid; a step of 1 or less rounds nothing. */
export function roundToInterval(
  seconds: number,
  step: number,
  rounding: IntervalRounding = 'ceil',
): number {
  if (!(step > 1)) return seconds;
  return Math[rounding](seconds / step) * step;
}
