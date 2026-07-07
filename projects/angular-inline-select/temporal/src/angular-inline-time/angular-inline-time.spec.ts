import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineTime, type InlineTimeSaved } from './angular-inline-time';
import { parseTime, parseTimeDraft, formatWallClock } from './time-codec';
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

  saved: (string | null)[] = [];
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

    expect(document.querySelector('.inline-time__preview')?.textContent?.trim()).toBe('✓ 21:05');

    press(h, 'Enter');

    expect(h.host.saved).toEqual([at('21:05')]);
    expect(h.host.sessions).toEqual([{ value: at('21:05'), changed: true, dayOverflow: 0, explicitDay: false }]);
    expect(h.host.model()).toBe(at('21:05'));
    expect(localDayOf(h.host.model())).toBe(DAY); // the day survives the edit
    expect(h.input().value).toBe('21:05');
    expect(h.panel()).toBeNull(); // Enter dismisses the panel
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
    expect(h.host.sessions).toEqual([{ value: at('09:30'), changed: false, dayOverflow: 0, explicitDay: false }]);
  });

  it('blur with a readable draft COMMITS (navigation never traps)', async () => {
    type(h, '2105');
    await blurAway(h);

    expect(h.host.saved).toEqual([at('21:05')]);
    expect(h.host.sessions).toEqual([{ value: at('21:05'), changed: true, dayOverflow: 0, explicitDay: false }]);
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
    expect(h.host.saved).toEqual([at('14:45')]);
    expect(h.host.sessions).toEqual([{ value: at('14:45'), changed: true, dayOverflow: 0, explicitDay: false }]);
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
    expect(h.host.saved).toEqual([at('10:15')]);
  });

  it('an overflow draft commits onto the anchor day + n with a +n preview', () => {
    type(h, '24:30');

    expect(document.querySelector('.inline-time__preview')?.textContent?.trim()).toBe(
      '✓ 00:30 +1 day',
    );

    press(h, 'Enter');

    expect(h.host.model()).toBe(composeDbEntry('2026-07-22', '00:30'));
    expect(h.host.sessions).toEqual([
      { value: composeDbEntry('2026-07-22', '00:30'), changed: true, dayOverflow: 1, explicitDay: false },
    ]);
  });

  it('a pasted FULL ISO datetime is an explicit instant — its own day, no anchor', () => {
    type(h, '2026-07-25T08:00');

    expect(document.querySelector('.inline-time__preview')?.textContent?.trim()).toContain('✓');
    // Live channel already carries the full instant.
    expect(h.host.field().value()).toBe(composeDbEntry('2026-07-25', '08:00'));

    press(h, 'Enter');

    expect(h.host.sessions).toEqual([
      {
        value: composeDbEntry('2026-07-25', '08:00'),
        changed: true,
        dayOverflow: 0,
        explicitDay: true,
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
});
