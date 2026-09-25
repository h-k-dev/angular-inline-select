import { roundToInterval } from './interval-rounding';

describe('roundToInterval', () => {
  const QUARTER = 900;

  it('ceil (the default) lands UP on the grid — billed time never under-reports', () => {
    expect(roundToInterval(16 * 60, QUARTER)).toBe(30 * 60);
    expect(roundToInterval(15 * 60, QUARTER)).toBe(15 * 60); // on the grid: untouched
  });

  it('round lands on the NEAREST multiple, floor on the previous one', () => {
    expect(roundToInterval(22 * 60, QUARTER, 'round')).toBe(15 * 60);
    expect(roundToInterval(23 * 60, QUARTER, 'round')).toBe(30 * 60);
    expect(roundToInterval(29 * 60, QUARTER, 'floor')).toBe(15 * 60);
  });

  it('a step of 1 or less rounds nothing', () => {
    expect(roundToInterval(1234, 1, 'ceil')).toBe(1234);
    expect(roundToInterval(1234, 0, 'floor')).toBe(1234);
  });
});
