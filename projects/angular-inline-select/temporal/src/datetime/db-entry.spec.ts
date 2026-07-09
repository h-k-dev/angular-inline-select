import {
  composeDbEntry,
  localDayOf,
  localTimeOf,
  rollDbEntryForward,
} from './db-entry';

// All expectations pin an explicit display zone, so the specs are
// machine-independent — DST cases NEED a zone that actually observes it.
const ZONE = 'Europe/Berlin';
const at = (day: string, time: string) => composeDbEntry(day, time, ZONE);

describe('rollDbEntryForward', () => {
  it('leaves an end strictly after the start untouched', () => {
    const start = at('2026-07-21', '09:00');
    const end = at('2026-07-21', '17:30');
    expect(rollDbEntryForward(start, end, ZONE)).toBe(end);
  });

  it('rolls a same-day at-or-before end to the next day, wall clock preserved', () => {
    const start = at('2026-07-21', '22:00');

    const overnight = rollDbEntryForward(start, at('2026-07-21', '06:00'), ZONE);
    expect(localDayOf(overnight, ZONE)).toBe('2026-07-22');
    expect(localTimeOf(overnight, ZONE)).toBe('06:00');

    // Equal instants are at-or-before too — the +1 seed.
    const equal = rollDbEntryForward(start, start, ZONE);
    expect(localDayOf(equal, ZONE)).toBe('2026-07-22');
    expect(localTimeOf(equal, ZONE)).toBe('22:00');
  });

  it('crosses a multi-day gap in one roll', () => {
    const start = at('2026-07-30', '08:00');

    // Ten days behind, later wall clock: lands on the start's own day.
    const sameDay = rollDbEntryForward(start, at('2026-07-20', '20:00'), ZONE);
    expect(localDayOf(sameDay, ZONE)).toBe('2026-07-30');
    expect(localTimeOf(sameDay, ZONE)).toBe('20:00');

    // Earlier wall clock: the start-day landing is still at-or-before, so
    // the roll nudges once more — next morning.
    const nextDay = rollDbEntryForward(start, at('2026-07-29', '07:00'), ZONE);
    expect(localDayOf(nextDay, ZONE)).toBe('2026-07-31');
    expect(localTimeOf(nextDay, ZONE)).toBe('07:00');
  });

  it('preserves the wall clock across the spring-forward DST transition', () => {
    // Berlin springs forward in the night of 2026-03-28 → 2026-03-29.
    const start = at('2026-03-28', '22:00');
    const rolled = rollDbEntryForward(start, at('2026-03-28', '21:00'), ZONE);

    // A typed end is wall-clock intent: still 21:00, now on the 29th —
    // a fixed 86 400 s shift would read 22:00 (the DST drift).
    expect(localDayOf(rolled, ZONE)).toBe('2026-03-29');
    expect(localTimeOf(rolled, ZONE)).toBe('21:00');
    expect(rolled).toBe('2026-03-29T19:00:00.000Z');
  });

  it('preserves the wall clock across the fall-back DST transition', () => {
    // Berlin falls back in the night of 2026-10-24 → 2026-10-25.
    const start = at('2026-10-24', '22:00');
    const rolled = rollDbEntryForward(start, at('2026-10-24', '21:00'), ZONE);

    expect(localDayOf(rolled, ZONE)).toBe('2026-10-25');
    expect(localTimeOf(rolled, ZONE)).toBe('21:00');
    expect(rolled).toBe('2026-10-25T20:00:00.000Z');
  });

  it('returns the end unchanged when either side is unreadable', () => {
    expect(rollDbEntryForward('not-a-date', at('2026-07-21', '06:00'), ZONE)).toBe(
      at('2026-07-21', '06:00'),
    );
    expect(rollDbEntryForward(at('2026-07-21', '22:00'), 'not-a-date', ZONE)).toBe('not-a-date');
  });
});
