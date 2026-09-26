import { DateTime } from 'luxon';
import {
  addDays,
  compareIsoDate,
  isIsoDate,
  isoDateOfInstant,
  isWeekend,
  weekdayOf,
} from './iso-date';

describe('iso-date', () => {
  it('accepts only real calendar dates spelled yyyy-MM-dd', () => {
    expect(isIsoDate('2026-05-12')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);

    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-5-12')).toBe(false);
    expect(isIsoDate('2026-05-12 00:00:00')).toBe(false);
    expect(isIsoDate('2026-05-12T00:00:00.000Z')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('shifts by calendar days across month, year, leap day and DST', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-05-12', -7)).toBe('2026-05-05');
  });

  it('knows the weekend as Saturday and Sunday', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(isWeekend('2026-10-03')).toBe(true);
    expect(isWeekend('2026-10-04')).toBe(true);
    expect(isWeekend('2026-10-02')).toBe(false);
  });

  it('orders dates', () => {
    expect(compareIsoDate('2026-05-11', '2026-05-12')).toBeLessThan(0);
    expect(compareIsoDate('2026-05-12', '2026-05-12')).toBe(0);
    expect(compareIsoDate('2027-01-01', '2026-12-31')).toBeGreaterThan(0);
  });

  it('reads the date an instant falls on in a zone', () => {
    const instant = DateTime.fromISO('2026-05-11T22:30:00Z');
    expect(isoDateOfInstant(instant, 'Europe/Berlin')).toBe('2026-05-12');
    expect(isoDateOfInstant(instant, 'UTC')).toBe('2026-05-11');
    expect(isoDateOfInstant(instant.toJSDate(), 'America/New_York')).toBe('2026-05-11');
  });
});
