import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineTime, type InlineTimeSaved } from './angular-inline-time';
import {
  parseTime,
  parseTimeDraft,
  formatWallClock,
  type InlineTimeValue,
  type TimeSavedDetails,
} from './time-codec';

/** The commit payloads' start instants, back as DB entries (spec convenience). */
const savedStarts = (details: TimeSavedDetails[]) =>
  details.map((d) => d.start?.toUTC().toISO() ?? null);
import {
  composeDbEntry,
  dayToDbEntry,
  localDayDiff,
  localTimeOf,
  localDayOf,
  parseDbEntryDraft,
  todayIn,
} from '../datetime/db-entry';

// The value contract: UTC ISO DB entries behind, local display in front.
// Expectations compose through the same helpers, so specs are TZ-independent.
const DAY = '2026-07-21';
const at = (time: string) => composeDbEntry(DAY, time);

// =============================================================================
// Codec
// =============================================================================

describe('time codec', () => {
  it('parses separated and compact shapes', () => {
    expect(parseTime('9:30')).toBe('09:30');
    expect(parseTime('09.30')).toBe('09:30');
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('21')).toBe('21:00');
    expect(parseTime('930')).toBe('09:30');
    expect(parseTime('2105')).toBe('21:05');
  });

  it('empty is null; impossible times and garbage are undefined', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('25:00')).toBeUndefined(); // overflow — only parseTimeDraft carries it
    expect(parseTime('9:75')).toBeUndefined();
    expect(parseTimeDraft('9:75')).toBeUndefined();
    expect(parseTime('soon')).toBeUndefined();
  });

  it('overflow hours declare the day over-count by hand', () => {
    expect(parseTimeDraft('24:30')).toEqual({ time: '00:30', days: 1 });
    expect(parseTimeDraft('2430')).toEqual({ time: '00:30', days: 1 });
    expect(parseTimeDraft('240:30')).toEqual({ time: '00:30', days: 10 });
    expect(parseTimeDraft('30:00')).toEqual({ time: '06:00', days: 1 });
    expect(parseTimeDraft('9:30')).toEqual({ time: '09:30', days: 0 });

    // Bare 1-2 digit hours stay strict; bad minutes still gate.
    expect(parseTimeDraft('99')).toBeUndefined();
    expect(parseTimeDraft('24:75')).toBeUndefined();

    // The overflow-free convenience rejects what it cannot carry.
    expect(parseTime('24:30')).toBeUndefined();
  });

  it('the round-trip law: the display 12 h formats parse back', () => {
    expect(parseTime('9:30 AM', 'en')).toBe('09:30');
    expect(parseTime('9:30 PM', 'en')).toBe('21:30');
    expect(parseTime('12:00 AM', 'en')).toBe('00:00');
    expect(parseTime('12:30 PM', 'en')).toBe('12:30');
    expect(parseTime('9 pm')).toBe('21:00'); // universal spellings, no locale
    expect(parseTime('13:00 PM', 'en')).toBeUndefined(); // nonsense hour with meridiem
    expect(parseTimeDraft('24:30 PM', 'en')).toBeUndefined(); // overflow + AM/PM is nonsense

    // Property: parse(format(time)) === time, per locale.
    for (const locale of ['en', 'de']) {
      for (const time of ['00:00', '09:30', '12:00', '21:05']) {
        expect(parseTime(formatWallClock(time, locale), locale)).toBe(time);
      }
    }
  });

  it('formats through Intl per locale', () => {
    expect(formatWallClock('09:30', 'en')).toBe('9:30 AM');
    expect(formatWallClock('21:05', 'de')).toBe('21:05');
    expect(formatWallClock(null)).toBe('');
  });

  it("an optional :ss tail parses (the 'HH:mm:ss' format round-trip)", () => {
    expect(parseTimeDraft('21:30:15')).toEqual({ time: '21:30:15', days: 0 });
    expect(parseTimeDraft('21:30:75')).toBeUndefined(); // bad seconds gate
    expect(parseTimeDraft('9:30:00 PM', 'en')).toBeUndefined(); // seconds + meridiem stay apart
  });
});

// =============================================================================
// T6 — the display zone is configuration, the value is not
// =============================================================================

describe('db-entry zones (T6)', () => {
  // 2026-07-21 is summer: New York = UTC-4 (EDT), Tokyo = UTC+9.
  const NY = 'America/New_York';
  const TOKYO = 'Asia/Tokyo';

  it('the same instant reads as DIFFERENT calendar days per zone', () => {
    const instant = '2026-07-21T23:30:00.000Z';
    expect(localDayOf(instant, NY)).toBe('2026-07-21'); // 19:30 EDT
    expect(localDayOf(instant, TOKYO)).toBe('2026-07-22'); // 08:30 JST
    expect(localTimeOf(instant, NY)).toBe('19:30');
  });

  it('day boundaries and compositions run in the display zone', () => {
    expect(dayToDbEntry('2026-07-21', NY)).toBe('2026-07-21T04:00:00.000Z');
    expect(composeDbEntry('2026-07-21', '21:00', NY)).toBe('2026-07-22T01:00:00.000Z');
    // An offset-less pasted draft reads in the display zone too.
    expect(parseDbEntryDraft('2026-07-21 21:00', NY)).toBe('2026-07-22T01:00:00.000Z');
  });

  it('the +n over-count is a ZONE question — the same range differs per wall', () => {
    const start = composeDbEntry('2026-07-21', '21:00', NY);
    const end = composeDbEntry('2026-07-22', '06:00', NY);
    expect(localDayDiff(start, end, NY)).toBe(1); // overnight in New York…
    expect(localDayDiff(start, end, TOKYO)).toBe(0); // …same Tokyo afternoon/evening
  });

  it('todayIn reads the reference clock in the zone', () => {
    // 23:30 UTC on Jul 21 is already Jul 22 in Tokyo.
    const clock = new Date('2026-07-21T23:30:00.000Z');
    expect(todayIn(clock, TOKYO)).toBe('2026-07-22');
    expect(todayIn(clock, NY)).toBe('2026-07-21');
  });
});

@Component({
  imports: [AngularInlineTime, FormField],
  template: `
    <angular-inline-time
      [formField]="field"
      locale="en-u-hc-h23"
      zone="America/New_York"
      pickerMin="08:00"
      pickerMax="18:00"
      (saved)="sessions.push($event)"
    />
  `,
})
class ZonedTimeHost {
  model = signal<string | null>(composeDbEntry('2026-07-21', '21:00', 'America/New_York'));
  field = form(this.model);

  sessions: InlineTimeSaved[] = [];
}

describe('AngularInlineTime with a display zone (T6) + native bounds (T3)', () => {
  it('displays the ZONE wall clock and re-composes commits in it', () => {
    const fixture = TestBed.createComponent(ZonedTimeHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.inline-time__input') as HTMLInputElement;

    expect(input.value).toBe('21:00'); // New York's 21:00, whatever the machine zone

    input.focus();
    fixture.detectChanges();
    input.value = '9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.model()).toBe(
      composeDbEntry('2026-07-21', '09:00', 'America/New_York'),
    );

    input.blur();
  });

  it('T3: min/max forward to the native picker input', () => {
    const fixture = TestBed.createComponent(ZonedTimeHost);
    fixture.detectChanges();
    const native = fixture.nativeElement.querySelector('.inline-time__native') as HTMLInputElement;

    expect(native.getAttribute('min')).toBe('08:00');
    expect(native.getAttribute('max')).toBe('18:00');
    expect(native.getAttribute('step')).toBe('60');
  });
});

// =============================================================================
// Component — the input rehost: one real input, gesture-tiered sessions
// =============================================================================

@Component({
  imports: [AngularInlineTime, FormField],
  template: `
    <angular-inline-time
      [formField]="field"
      locale="de"
      [native]="native()"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
    />
  `,
})
class TimeFormHost {
  model = signal<string | null>(at('09:30'));
  field = form(this.model);
  native = signal(false);

  saved: TimeSavedDetails[] = [];
  sessions: InlineTimeSaved[] = [];
}

interface Harness {
  fixture: ComponentFixture<TimeFormHost>;
  host: TimeFormHost;
  input: () => HTMLInputElement;
  native: () => HTMLInputElement;
  panel: () => HTMLElement | null;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(TimeFormHost);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    input: () => fixture.nativeElement.querySelector('.inline-time__input') as HTMLInputElement,
    native: () => fixture.nativeElement.querySelector('.inline-time__native') as HTMLInputElement,
    panel: () => document.querySelector('.inline-time__panel') as HTMLElement | null,
  };
}

/** Focus settlement runs a macrotask behind (`setTimeout(0)`) — flush it. */
async function settle(h: Harness) {
  h.fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  h.fixture.detectChanges();
}

function type(h: Harness, text: string) {
  const input = h.input();
  input.focus();
  h.fixture.detectChanges();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function press(h: Harness, key: string) {
  h.input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  h.fixture.detectChanges();
}

async function blurAway(h: Harness) {
  (document.activeElement as HTMLElement | null)?.blur();
  await settle(h);
}

describe('AngularInlineTime (input rehost)', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  afterEach(async () => {
    await blurAway(h);
  });

  it('renders the committed time localized in a real input', () => {
    expect(h.input().value).toBe('09:30');
  });

  it('Enter commits typed drafts as DB entries anchored on the value own day', async () => {
    type(h, '2105');
    press(h, 'Enter');

    expect(savedStarts(h.host.saved)).toEqual([at('21:05')]);
    // Single mode pins the details shape: Luxon start, no end, zero duration.
    expect(h.host.saved[0].end).toBeNull();
    expect(h.host.saved[0].duration).toBe(0);
    expect(h.host.sessions).toEqual([
      { value: at('21:05'), changed: true, dayOverflow: 0, explicitDay: false, side: 'start' },
    ]);
    expect(h.host.model()).toBe(at('21:05'));
    expect(localDayOf(h.host.model())).toBe(DAY); // the day survives the edit
    expect(h.input().value).toBe('21:05');
    expect(h.panel()).toBeNull(); // no panel for a clean commit — there is no preview
  });

  it('the parse gate blocks Enter on impossible times', () => {
    type(h, '9:75');
    press(h, 'Enter');

    expect(h.host.saved).toEqual([]);
    expect(h.host.field().value()).toBe(at('09:30'));
    expect(h.input().getAttribute('aria-invalid')).toBe('true');
  });

  it('blur with an unreadable draft SNAPS BACK to the baseline', async () => {
    type(h, '9:75');
    await blurAway(h);

    expect(h.host.field().value()).toBe(at('09:30'));
    expect(h.input().value).toBe('09:30');
    expect(h.host.saved).toEqual([]);
    expect(h.host.sessions).toEqual([
      { value: at('09:30'), changed: false, dayOverflow: 0, explicitDay: false, side: 'start' },
    ]);
  });

  it('blur with a readable draft COMMITS (navigation never traps)', async () => {
    type(h, '2105');
    await blurAway(h);

    expect(savedStarts(h.host.saved)).toEqual([at('21:05')]);
    expect(h.host.sessions).toEqual([
      { value: at('21:05'), changed: true, dayOverflow: 0, explicitDay: false, side: 'start' },
    ]);
  });

  it('Escape reverts to the session baseline', () => {
    type(h, '2105');
    press(h, 'Escape');

    expect(h.host.field().value()).toBe(at('09:30'));
    expect(h.input().value).toBe('09:30');
    expect(h.host.saved).toEqual([]);
  });

  it('there is no trigger button — native mode is the one picker affordance', () => {
    expect(h.fixture.nativeElement.querySelector('button')).toBeNull();

    h.host.native.set(true);
    h.fixture.detectChanges();

    expect(h.fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('native mode: a click on the field opens the OS picker, seeded with the value', () => {
    h.host.native.set(true);
    h.fixture.detectChanges();

    const shown: string[] = [];
    (h.native() as HTMLInputElement & { showPicker: () => void }).showPicker = function (
      this: HTMLInputElement,
    ) {
      shown.push(this.value);
    };

    h.input().click();
    expect(shown).toEqual(['09:30']);

    // Off, the field's click stays a plain caret placement.
    h.host.native.set(false);
    h.fixture.detectChanges();
    h.input().click();
    expect(shown).toEqual(['09:30']);
  });

  it('an OS-picker change while idle commits immediately', () => {
    const native = h.native();
    native.value = '14:45';
    native.dispatchEvent(new Event('change', { bubbles: true }));
    h.fixture.detectChanges();

    expect(h.host.model()).toBe(at('14:45'));
    expect(savedStarts(h.host.saved)).toEqual([at('14:45')]);
    expect(h.host.sessions).toEqual([
      { value: at('14:45'), changed: true, dayOverflow: 0, explicitDay: false, side: 'start' },
    ]);
    expect(h.input().value).toBe('14:45');
  });

  it('an OS-picker change during a session replaces the draft without committing', () => {
    type(h, '9');

    const native = h.native();
    native.value = '10:15';
    native.dispatchEvent(new Event('change', { bubbles: true }));
    h.fixture.detectChanges();

    // Draft replaced, session still open, nothing committed yet.
    expect(h.host.saved).toEqual([]);
    expect(h.input().value).toBe('10:15');
    expect(h.host.field().value()).toBe(at('10:15')); // live channel

    press(h, 'Enter');
    expect(savedStarts(h.host.saved)).toEqual([at('10:15')]);
  });

  it('an overflow draft commits onto the anchor day + n', () => {
    type(h, '24:30');
    press(h, 'Enter');

    expect(h.host.model()).toBe(composeDbEntry('2026-07-22', '00:30'));
    expect(h.host.sessions).toEqual([
      {
        value: composeDbEntry('2026-07-22', '00:30'),
        changed: true,
        dayOverflow: 1,
        explicitDay: false,
        side: 'start',
      },
    ]);
  });

  it('a pasted FULL ISO datetime is an explicit instant — its own day, no anchor', () => {
    type(h, '2026-07-25T08:00');

    // Live channel already carries the full instant.
    expect(h.host.field().value()).toBe(composeDbEntry('2026-07-25', '08:00'));

    press(h, 'Enter');

    expect(h.host.sessions).toEqual([
      {
        value: composeDbEntry('2026-07-25', '08:00'),
        changed: true,
        dayOverflow: 0,
        explicitDay: true,
        side: 'start',
      },
    ]);
    expect(localDayOf(h.host.model())).toBe('2026-07-25'); // the day CAME ALONG
  });

  it('a time typed into an EMPTY field anchors on the reference clock day', () => {
    h.host.model.set(null);
    h.fixture.detectChanges();

    type(h, '8');
    press(h, 'Enter');

    const value = h.host.model();
    expect(localTimeOf(value)).toBe('08:00');
    expect(localDayOf(value)).toBe(localDayOf(new Date().toISOString()));
  });

  it('an EMPTY-STRING bound value anchors like empty — the typed time is never dropped', () => {
    // A raw DB default: '' is not null, but it is no instant either.
    h.host.model.set('');
    h.fixture.detectChanges();

    type(h, '9');
    press(h, 'Enter');

    const value = h.host.model();
    expect(localTimeOf(value)).toBe('09:00');
    expect(localDayOf(value)).toBe(localDayOf(new Date().toISOString()));
  });
});

// =============================================================================
// The two-field range — shape-echo, the overnight roll, per-side sessions
// =============================================================================

@Component({
  imports: [AngularInlineTime],
  template: `
    <angular-inline-time
      [(value)]="value"
      [ranged]="ranged()"
      [native]="native()"
      locale="en-u-hc-h23"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
    />
  `,
})
class TimeShapeHost {
  // Seeded OVERNIGHT: the end instant is on the next day (the +1 badge).
  value = signal<InlineTimeValue>({
    start: at('22:00'),
    end: composeDbEntry('2026-07-22', '01:30'),
  });
  ranged = signal(false);
  native = signal(false);

  saved: TimeSavedDetails[] = [];
  sessions: InlineTimeSaved[] = [];
}

interface RangeHarness {
  fixture: ComponentFixture<TimeShapeHost>;
  host: TimeShapeHost;
  inputs: () => HTMLInputElement[];
  start: () => HTMLInputElement;
  end: () => HTMLInputElement | undefined;
  badge: () => HTMLElement | null;
}

function setupRange(): RangeHarness {
  const fixture = TestBed.createComponent(TimeShapeHost);
  fixture.detectChanges();

  const inputs = () =>
    [...fixture.nativeElement.querySelectorAll('.inline-time__input')] as HTMLInputElement[];

  return {
    fixture,
    host: fixture.componentInstance,
    inputs,
    start: () => inputs()[0],
    end: () => inputs()[1],
    badge: () => fixture.nativeElement.querySelector('.time-day-badge') as HTMLElement | null,
  };
}

function typeInto(r: RangeHarness, input: HTMLInputElement, text: string) {
  input.focus();
  r.fixture.detectChanges();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  r.fixture.detectChanges();
}

function pressOn(r: RangeHarness, input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  r.fixture.detectChanges();
}

async function settleRange(r: RangeHarness) {
  r.fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  r.fixture.detectChanges();
}

async function blurAwayRange(r: RangeHarness) {
  (document.activeElement as HTMLElement | null)?.blur();
  await settleRange(r);
}

describe('AngularInlineTime two-field range', () => {
  let r: RangeHarness;

  beforeEach(() => {
    r = setupRange();
  });

  afterEach(async () => {
    await blurAwayRange(r);
  });

  it('a string binding renders one field; object shapes render the pair with the +n badge', () => {
    r.host.value.set(at('09:30'));
    r.fixture.detectChanges();
    expect(r.inputs().length).toBe(1);
    expect(r.badge()).toBeNull(); // standalone single: no group feed, no badge

    r.host.value.set({ start: at('22:00'), end: composeDbEntry('2026-07-22', '01:30') });
    r.fixture.detectChanges();
    expect(r.inputs().length).toBe(2);
    expect(r.start().value).toBe('22:00');
    expect(r.end()!.value).toBe('01:30');
    expect(r.badge()!.textContent).toBe('+1'); // intrinsic — the pair's own days
  });

  it('null + ranged=true cold-starts as the pair and emits the range shape', () => {
    r.host.value.set(null);
    r.host.ranged.set(true);
    r.fixture.detectChanges();

    expect(r.inputs().length).toBe(2);
    expect(r.start().placeholder).toBe('time'); // fully empty: both hint the placeholder
    expect(r.end()!.placeholder).toBe('time');

    typeInto(r, r.start(), '22');
    pressOn(r, r.start(), 'Enter');

    const start = r.host.value();
    expect(typeof start).toBe('object'); // the range shape, not a bare string
    expect((start as { start: string | null; end: string | null }).end).toBeNull();
    expect(r.end()!.placeholder).toBe('…'); // half-open: the end side hints continuation
  });

  it('a native pick lands on the side the picker was OPENED for, even after focus strayed', async () => {
    r.host.native.set(true);
    r.fixture.detectChanges();

    const native = r.fixture.nativeElement.querySelector('.inline-time__native') as HTMLInputElement;
    (native as HTMLInputElement & { showPicker: () => void }).showPicker = () => {};

    // Open the picker FOR THE END (native mode: the field's own click).
    r.end()!.focus();
    r.fixture.detectChanges();
    r.end()!.click();
    r.fixture.detectChanges();
    expect(native.value).toBe('01:30'); // seeded with the end's wall clock

    // Focus strays to the start before the picker's change lands.
    r.start().focus();
    r.fixture.detectChanges();

    native.value = '02:45';
    native.dispatchEvent(new Event('change', { bubbles: true }));
    r.fixture.detectChanges();
    await settleRange(r);

    // The pick belongs to the END — the start must not swallow it.
    const value = r.host.value() as { start: string | null; end: string | null };
    expect(value.start).toBe(at('22:00'));
    expect(value.end).toBe(composeDbEntry('2026-07-22', '02:45'));
  });

  it('Tab-advance settles the departing side BEFORE the landing session baselines — Escape restores the rolled pair', async () => {
    // A same-day pair, so typing a later start inverts it until the roll.
    r.host.value.set({ start: at('22:00'), end: at('23:00') });
    r.fixture.detectChanges();

    typeInto(r, r.start(), '23:30'); // live channel: {23:30, 23:00} — inverted, not yet rolled
    r.end()!.focus(); // Tab lands in the end
    r.fixture.detectChanges();

    // Landing settled the start synchronously: the end rolled next-day.
    const rolled = { start: at('23:30'), end: composeDbEntry('2026-07-22', '23:00') };
    expect(r.host.value()).toEqual(rolled);
    expect(r.badge()!.textContent).toBe('+1');

    pressOn(r, r.end()!, 'Escape');
    await settleRange(r);

    // The end session's baseline is the RECONCILED pair — Escape must never
    // resurrect the inverted mid-session state.
    expect(r.host.value()).toEqual(rolled);
    expect(r.badge()!.textContent).toBe('+1');
  });

  it('a typed end at-or-before the start ROLLS next-day on settlement (overnight law)', () => {
    typeInto(r, r.end()!, '21:00');
    pressOn(r, r.end()!, 'Enter');

    // 21:00 is before the 22:00 start → the end lands NEXT day 21:00.
    expect(r.host.value()).toEqual({
      start: at('22:00'),
      end: composeDbEntry('2026-07-22', '21:00'),
    });
    expect(r.badge()!.textContent).toBe('+1');
    expect(r.host.sessions.at(-1)!.changed).toBe(true);
  });

  it('a typed end after the start stays same-day and drops the badge', () => {
    typeInto(r, r.end()!, '23:30');
    pressOn(r, r.end()!, 'Enter');

    expect(r.host.value()).toEqual({ start: at('22:00'), end: at('23:30') });
    expect(r.badge()).toBeNull();
  });

  it('an overflow end draft anchors the over-count on the START day', () => {
    typeInto(r, r.end()!, '25:15');
    pressOn(r, r.end()!, 'Enter');

    expect(r.host.value()).toEqual({
      start: at('22:00'),
      end: composeDbEntry('2026-07-22', '01:15'),
    });
    expect(r.host.sessions.at(-1)).toEqual({
      value: { start: at('22:00'), end: composeDbEntry('2026-07-22', '01:15') },
      changed: true,
      dayOverflow: 1,
      explicitDay: false,
      side: 'end',
    });
  });

  it('a pasted FULL ISO end is EXPLICIT — taken as-is, never re-anchored or rolled', () => {
    typeInto(r, r.end()!, '2026-07-20 08:00');
    pressOn(r, r.end()!, 'Enter');

    // Before the start — the paste stands (the decomposition law); no badge.
    expect(r.host.value()).toEqual({
      start: at('22:00'),
      end: composeDbEntry('2026-07-20', '08:00'),
    });
    expect(r.badge()).toBeNull();
    expect(r.host.sessions.at(-1)!.explicitDay).toBe(true);
  });

  it('Escape reverts the PAIR — a side session can move the partner, so the whole value restores', () => {
    typeInto(r, r.end()!, '05');
    // The live channel already moved the end (no roll until settlement).
    expect(r.host.value()).toEqual({ start: at('22:00'), end: at('05:00') });

    pressOn(r, r.end()!, 'Escape');

    expect(r.host.value()).toEqual({
      start: at('22:00'),
      end: composeDbEntry('2026-07-22', '01:30'),
    });
    expect(r.end()!.value).toBe('01:30');
  });

  it('blur with an unreadable end draft SNAPS BACK to the baseline', async () => {
    typeInto(r, r.end()!, '9:99');
    await blurAwayRange(r);

    expect(r.host.value()).toEqual({
      start: at('22:00'),
      end: composeDbEntry('2026-07-22', '01:30'),
    });
    expect(r.end()!.value).toBe('01:30');
    expect(r.host.saved).toEqual([]);
  });

  it('Tab-advance: focus moving start → end settles the start; the pair keeps rolling', async () => {
    typeInto(r, r.start(), '23:00');
    r.end()!.focus(); // what Tab does
    await settleRange(r);

    // The start settled at 23:00; the end (next-day 01:30) still follows it.
    expect(r.host.value()).toEqual({
      start: at('23:00'),
      end: composeDbEntry('2026-07-22', '01:30'),
    });
    expect(r.host.sessions.length).toBe(1);
    expect(r.host.sessions[0]!.changed).toBe(true);
  });

  it('a start settling PAST the end rolls the end forward (the pair stays ordered)', () => {
    // End sits at next-day 01:30; move the start past it.
    r.host.value.set({ start: at('22:00'), end: at('23:00') });
    r.fixture.detectChanges();

    typeInto(r, r.start(), '23:30');
    pressOn(r, r.start(), 'Enter');

    expect(r.host.value()).toEqual({
      start: at('23:30'),
      end: composeDbEntry('2026-07-22', '23:00'),
    });
    expect(r.badge()!.textContent).toBe('+1');
  });

  it('each side owns its clear — the other side is NEVER nuked', () => {
    typeInto(r, r.end()!, '');
    pressOn(r, r.end()!, 'Enter');
    expect(r.host.value()).toEqual({ start: at('22:00'), end: null });

    typeInto(r, r.start(), '');
    pressOn(r, r.start(), 'Enter');
    expect(r.host.value()).toEqual({ start: null, end: null });
  });

  it('the one-key { start } shape grows the end key only on an END edit', () => {
    r.host.value.set({ start: at('22:00') });
    r.fixture.detectChanges();
    expect(r.inputs().length).toBe(2); // start-only IS a (half-open) range

    typeInto(r, r.start(), '21:00');
    pressOn(r, r.start(), 'Enter');
    expect(r.host.value()).toEqual({ start: at('21:00') }); // still one-key

    typeInto(r, r.end()!, '23:30');
    pressOn(r, r.end()!, 'Enter');
    expect(r.host.value()).toEqual({ start: at('21:00'), end: at('23:30') });
  });

  it('null remembers the last seen shape: a cleared one-key field stays one-key', () => {
    r.host.value.set({ start: at('22:00') });
    r.fixture.detectChanges();

    typeInto(r, r.start(), '');
    pressOn(r, r.start(), 'Enter');

    expect(r.host.value()).toEqual({ start: null });
    expect(r.inputs().length).toBe(2);
  });
});

// =============================================================================
// The seconds format ('HH:mm:ss') — displays, parses and composes seconds
// =============================================================================

@Component({
  imports: [AngularInlineTime],
  template: `<angular-inline-time [(value)]="value" format="HH:mm:ss" locale="en" />`,
})
class SecondsHost {
  value = signal<InlineTimeValue>(composeDbEntry(DAY, '21:30:15'));
}

describe('AngularInlineTime with the seconds format', () => {
  function setupSeconds() {
    const fixture = TestBed.createComponent(SecondsHost);
    fixture.detectChanges();

    return {
      fixture,
      host: fixture.componentInstance,
      input: () => fixture.nativeElement.querySelector('.inline-time__input') as HTMLInputElement,
    };
  }

  it('displays the RAW format string — meridiem-free even under an Intl 12 h locale', () => {
    const s = setupSeconds();
    expect(s.input().value).toBe('21:30:15');
  });

  it('a typed :ss tail commits seconds into the DB entry; plain HH:mm reads back :00', async () => {
    const s = setupSeconds();
    const input = s.input();
    input.focus();
    s.fixture.detectChanges();

    input.value = '9:05:30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    s.fixture.detectChanges();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    s.fixture.detectChanges();

    expect(s.host.value()).toBe(composeDbEntry(DAY, '09:05:30'));
    expect(input.value).toBe('09:05:30');

    input.value = '9:30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    s.fixture.detectChanges();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    s.fixture.detectChanges();

    expect(s.host.value()).toBe(composeDbEntry(DAY, '09:30'));
    expect(input.value).toBe('09:30:00');

    input.blur();
    await new Promise((resolve) => setTimeout(resolve));
    s.fixture.detectChanges();
  });
});


// =============================================================================
// Visually-hidden safety — the phantom-scroll regression guard
// =============================================================================

describe('the aria-live announcer (visually hidden)', () => {
  it('is PINNED to its containing block — an offset-less absolute box keeps its static position and inflates a far-away scroller (the flex-table phantom-scroll bug)', () => {
    const h = setup();
    const sr = h.fixture.nativeElement.querySelector('.inline-time__sr') as HTMLElement;
    expect(sr).not.toBeNull();

    const style = getComputedStyle(sr);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe('0px');
    expect(style.left).toBe('0px');
  });
});
