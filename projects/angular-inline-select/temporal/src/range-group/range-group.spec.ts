import { Component, signal, viewChild, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { AngularInlineDuration } from '../angular-inline-duration/angular-inline-duration';
import { composeDbEntry, dayToDbEntry, dayEndToDbEntry } from '../datetime/db-entry';
import {
  DateTimeRangeGroup,
  RangeDay,
  RangeEndDay,
  RangeStart,
  RangeEnd,
  RangeLength,
  type ComposedDateRange,
  type ComposedTimeRange,
  type TemporalRangeValue,
} from './range-group';

const NOW = new Date(2026, 6, 21);

// Every value is a UTC ISO DB entry; expectations compose through the same
// helpers, so the specs are TZ-independent. The seed is an OVERNIGHT stay:
// 21 Jul 21:00 → 22 Jul 06:00, 9 h — the +1 lives IN the end value.
const at = (day: string, time: string) => composeDbEntry(day, time);

// The quintet fixture (the maximal form): stay · start · end · length · end day.
// The end-day leaf appends LAST so the older tests' input indices survive.
@Component({
  imports: [
    AngularInlineDate,
    AngularInlineTime,
    AngularInlineDuration,
    DateTimeRangeGroup,
    RangeDay,
    RangeEndDay,
    RangeStart,
    RangeEnd,
    RangeLength,
  ],
  template: `
    <div
      dateTimeRangeGroup
      (dateRangeChange)="dateRanges.push($event)"
      (timeRangeChange)="timeRanges.push($event)"
      (durationChange)="durations.push($event)"
    >
      <angular-inline-date rangeDay [(value)]="day" locale="en" [now]="now" />
      <angular-inline-time rangeStart [(value)]="start" locale="en-u-hc-h23" [now]="now" />
      <angular-inline-time rangeEnd [(value)]="end" locale="en-u-hc-h23" [now]="now" />
      <angular-inline-duration rangeLength [(value)]="length" />
      <angular-inline-date rangeEndDay [(value)]="endDay" locale="en" [now]="now" />
    </div>
  `,
})
class QuartetHost {
  group = viewChild.required(DateTimeRangeGroup);

  day = signal<string | null>(dayToDbEntry('2026-07-21'));
  start = signal<string | null>(at('2026-07-21', '21:00'));
  end = signal<string | null>(at('2026-07-22', '06:00'));
  length = signal<number | null>(32_400);
  endDay = signal<string | null>(dayToDbEntry('2026-07-22'));

  dateRanges: (ComposedDateRange | null)[] = [];
  timeRanges: (ComposedTimeRange | null)[] = [];
  durations: (number | null)[] = [];

  now = () => NOW;
}

// Every leaf is a REAL INPUT since the rehost — one selector, DOM order.
const LEAF_INPUTS = '.inline-date__input, .inline-time__input, .inline-duration__input';

interface Harness {
  fixture: ComponentFixture<QuartetHost>;
  host: QuartetHost;
  group: () => DateTimeRangeGroup;
  inputs: () => HTMLInputElement[];
}

function setup(): Harness {
  const fixture = TestBed.createComponent(QuartetHost);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    group: () => fixture.componentInstance.group(),
    inputs: () => [...fixture.nativeElement.querySelectorAll(LEAF_INPUTS)] as HTMLInputElement[],
  };
}

/**
 * Type into the leaf input at `index` and commit with Enter (synchronous);
 * the trailing blur flushes the focus-settlement timer.
 */
async function commitInto(h: Harness, index: number, text: string) {
  const input = h.inputs()[index];
  input.focus();
  h.fixture.detectChanges();

  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();

  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  h.fixture.detectChanges();

  input.blur();
  await new Promise((resolve) => setTimeout(resolve));
  h.fixture.detectChanges();
}

// Leaf input order in the template: 0 day · 1 start · 2 end · 3 length · 4 end day.
const START = 1;
const END = 2;
const LENGTH = 3;
const END_DAY = 4;

describe('DateTimeRangeGroup', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('registers the quartet and composes its state', () => {
    expect(h.group().day()).toBe('2026-07-21');
    expect(h.group().start()).toBe(at('2026-07-21', '21:00'));
    expect(h.group().end()).toBe(at('2026-07-22', '06:00'));
    expect(h.group().length()).toBe(32_400);
  });

  it('the overnight seed wears the +1 badge — intrinsic to the values', () => {
    expect(h.group().endDayOffset()).toBe(1);

    const badges = [...h.fixture.nativeElement.querySelectorAll('.time-day-badge')];
    expect(badges.map((badge) => badge.textContent?.trim())).toEqual(['+1']);
  });

  it('a typed end is wall-clock intent: 23:30 lands the same evening, badge drops', async () => {
    await commitInto(h, END, '23:30');

    expect(h.host.end()).toBe(at('2026-07-21', '23:30'));
    expect(h.host.length()).toBe(2.5 * 3600);
    expect(h.group().endDayOffset()).toBe(0);
    expect(h.fixture.nativeElement.querySelector('.time-day-badge')).toBeNull();
  });

  it('an end at or before the start rolls to the next day (+24 h)', async () => {
    await commitInto(h, END, '21:00');

    expect(h.host.end()).toBe(at('2026-07-22', '21:00'));
    expect(h.host.length()).toBe(24 * 3600);
    expect(h.group().endDayOffset()).toBe(1);
  });

  it('typed overflow hours ARE the over-count, anchored on the start day', async () => {
    // 24:30 = next day 00:30 — over computed from the typed hours.
    await commitInto(h, END, '24:30');

    expect(h.host.end()).toBe(at('2026-07-22', '00:30'));
    expect(h.host.length()).toBe(3.5 * 3600); // 21:00 → +1 00:30
    expect(h.group().endDayOffset()).toBe(1);

    // 240:30 = ten days out at 00:30.
    await commitInto(h, END, '240:30');

    expect(h.host.end()).toBe(at('2026-07-31', '00:30'));
    expect(h.group().endDayOffset()).toBe(10);
    expect(
      h.fixture.nativeElement.querySelector('.time-day-badge')?.textContent?.trim(),
    ).toBe('+10');
  });

  it('committing a duration MOVES the end instant; multi-day lengths grow the badge', async () => {
    await commitInto(h, LENGTH, '2:00');
    expect(h.host.end()).toBe(at('2026-07-21', '23:00'));
    expect(h.group().endDayOffset()).toBe(0);

    await commitInto(h, LENGTH, '30h');
    expect(h.host.end()).toBe(at('2026-07-23', '03:00')); // 21:00 + 30 h
    expect(h.group().endDayOffset()).toBe(2);
  });

  it('committing a start keeps the end instant and follows with the duration', async () => {
    await commitInto(h, START, '22:00');

    expect(h.host.start()).toBe(at('2026-07-21', '22:00'));
    expect(h.host.end()).toBe(at('2026-07-22', '06:00'));
    expect(h.host.length()).toBe(8 * 3600);
    expect(h.group().endDayOffset()).toBe(1);
  });

  it('day edits shift BOTH instants, preserving wall-clock times and the over-count', async () => {
    await commitInto(h, 0, '24.7.2026');

    expect(h.host.day()).toBe(dayToDbEntry('2026-07-24'));
    expect(h.host.start()).toBe(at('2026-07-24', '21:00'));
    expect(h.host.end()).toBe(at('2026-07-25', '06:00'));
    expect(h.host.length()).toBe(32_400);
  });

  it('composes the date range with the over-count applied', () => {
    expect(h.group().dateRange()).toEqual({
      start: dayToDbEntry('2026-07-21'),
      end: dayEndToDbEntry('2026-07-22'),
    });
    expect(h.group().timeRange()).toEqual({
      start: at('2026-07-21', '21:00'),
      end: at('2026-07-22', '06:00'),
    });
  });

  it('emits the composed streams per commit — only the ones that changed', async () => {
    // End 23:30: same-day now — every stream moves.
    await commitInto(h, END, '23:30');

    expect(h.host.dateRanges).toEqual([
      { start: dayToDbEntry('2026-07-21'), end: dayEndToDbEntry('2026-07-21') },
    ]);
    expect(h.host.timeRanges).toEqual([
      { start: at('2026-07-21', '21:00'), end: at('2026-07-21', '23:30') },
    ]);
    expect(h.host.durations).toEqual([2.5 * 3600]);

    // Length 30h: end moves two days out.
    await commitInto(h, LENGTH, '30h');

    expect(h.host.dateRanges[1]).toEqual({
      start: dayToDbEntry('2026-07-21'),
      end: dayEndToDbEntry('2026-07-23'),
    });
    expect(h.host.timeRanges[1]).toEqual({
      start: at('2026-07-21', '21:00'),
      end: at('2026-07-23', '03:00'),
    });
    expect(h.host.durations[1]).toBe(30 * 3600);
  });

  it('day commits shift the instants: date and time ranges emit, duration stays silent', async () => {
    await commitInto(h, 0, '24.7.2026');

    expect(h.host.dateRanges).toEqual([
      { start: dayToDbEntry('2026-07-24'), end: dayEndToDbEntry('2026-07-25') },
    ]);
    expect(h.host.timeRanges).toEqual([
      { start: at('2026-07-24', '21:00'), end: at('2026-07-25', '06:00') },
    ]);
    expect(h.host.durations).toEqual([]);
  });

  it('end-day commits move the end onto the day, wall-clock preserved, duration follows', async () => {
    await commitInto(h, END_DAY, '24.7.2026');

    expect(h.host.end()).toBe(at('2026-07-24', '06:00'));
    expect(h.host.length()).toBe(57 * 3600); // 21 Jul 21:00 → 24 Jul 06:00
    expect(h.group().endDayOffset()).toBe(3);
  });

  it('an end-day BEFORE the start is an ERROR, not an auto-fix', async () => {
    await commitInto(h, END_DAY, '20.7.2026');

    // The violation STANDS (no roll-forward), the duration is underivable.
    expect(h.host.end()).toBe(at('2026-07-20', '06:00'));
    expect(h.host.length()).toBeNull();
    expect(h.group().orderingErrors().length).toBe(1);

    // Recovery clears the error and re-derives the duration.
    await commitInto(h, END_DAY, '22.7.2026');
    expect(h.group().orderingErrors()).toEqual([]);
    expect(h.host.length()).toBe(32_400);
  });

  it('ISO-paste into the START decomposes: the instant lands, the day leaves sync', async () => {
    await commitInto(h, START, '2026-07-25T08:00');

    expect(h.host.start()).toBe(at('2026-07-25', '08:00'));
    expect(h.host.day()).toBe(dayToDbEntry('2026-07-25')); // day leaf synced
    // The end rolled forward past the new start, wall-clock preserved.
    expect(h.host.end()).toBe(at('2026-07-26', '06:00'));
    expect(h.host.endDay()).toBe(dayToDbEntry('2026-07-26')); // end-day leaf synced
    expect(h.host.length()).toBe(22 * 3600);
  });

  it('ISO-paste into the END is explicit: no re-anchor, a violation stands as the error', async () => {
    await commitInto(h, END, '2026-07-19T06:00');

    expect(h.host.end()).toBe(at('2026-07-19', '06:00'));
    expect(h.host.length()).toBeNull();
    expect(h.group().orderingErrors().length).toBe(1);
  });

  it('group writes flow through value, never emitting saved on the written control', async () => {
    let endSessions = 0;
    const endControl = h.fixture.debugElement.children[0].children[2]
      .componentInstance as AngularInlineTime;
    endControl.saved.subscribe(() => endSessions++);

    await commitInto(h, LENGTH, '3:00');

    expect(h.host.end()).toBe(at('2026-07-22', '00:00'));
    expect(endSessions).toBe(0);
  });
});

// =============================================================================
// T5b — the group IS the form control
// =============================================================================

@Component({
  imports: [
    AngularInlineDate,
    AngularInlineTime,
    AngularInlineDuration,
    DateTimeRangeGroup,
    RangeDay,
    RangeStart,
    RangeEnd,
    RangeLength,
    FormField,
  ],
  template: `
    <div dateTimeRangeGroup [formField]="field" (savedModelChange)="commits.push($event)">
      <angular-inline-date rangeDay locale="en" [now]="now" />
      <angular-inline-time rangeStart locale="en-u-hc-h23" [now]="now" />
      <angular-inline-time rangeEnd locale="en-u-hc-h23" [now]="now" />
      <angular-inline-duration rangeLength />
    </div>
  `,
})
class BoundGroupHost {
  group = viewChild.required(DateTimeRangeGroup);

  model = signal<TemporalRangeValue | null>({
    start: at('2026-07-21', '21:00'),
    end: at('2026-07-22', '06:00'),
    duration: 32_400,
  });
  field = form(this.model);

  commits: (TemporalRangeValue | null)[] = [];

  now = () => NOW;
}

// The consumer's model has NO duration key — the shape-echo case.
@Component({
  imports: [
    AngularInlineDate,
    AngularInlineTime,
    AngularInlineDuration,
    DateTimeRangeGroup,
    RangeDay,
    RangeStart,
    RangeEnd,
    RangeLength,
    FormField,
  ],
  template: `
    <div dateTimeRangeGroup [formField]="field">
      <angular-inline-date rangeDay locale="en" [now]="now" />
      <angular-inline-time rangeStart locale="en-u-hc-h23" [now]="now" />
      <angular-inline-time rangeEnd locale="en-u-hc-h23" [now]="now" />
      <angular-inline-duration rangeLength />
    </div>
  `,
})
class RangeOnlyHost {
  model = signal<TemporalRangeValue | null>({
    start: at('2026-07-21', '21:00'),
    end: at('2026-07-22', '06:00'),
  });
  field = form(this.model);

  now = () => NOW;
}

// Mixed mode: a field-bound leaf inside a field-bound group — must throw.
@Component({
  imports: [AngularInlineTime, DateTimeRangeGroup, RangeStart, FormField],
  template: `
    <div dateTimeRangeGroup [formField]="field">
      <angular-inline-time rangeStart [formField]="leafField" />
    </div>
  `,
})
class MixedModeHost {
  model = signal<TemporalRangeValue | null>(null);
  field = form(this.model);

  leafModel = signal<string | null>(null);
  leafField = form(this.leafModel);
}

function boundSetup<T>(type: Type<T>) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    inputs: () =>
      [...fixture.nativeElement.querySelectorAll(LEAF_INPUTS)] as HTMLInputElement[],
  };
}

async function commitIntoBound(
  fixture: ComponentFixture<unknown>,
  inputs: () => HTMLInputElement[],
  index: number,
  text: string,
) {
  const input = inputs()[index];
  input.focus();
  fixture.detectChanges();

  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();

  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  fixture.detectChanges();

  input.blur();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('DateTimeRangeGroup as FormValueControl (T5b)', () => {
  it('the bound value flows DOWN: unbound leaves render the composed model', async () => {
    const h = boundSetup(BoundGroupHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.inputs().map((input) => input.value)).toEqual([
      'Jul 21, 2026',
      '21:00',
      '06:00',
      '9:00',
    ]);
  });

  it('a leaf commit flows UP: one composed model write, one savedModelChange', async () => {
    const h = boundSetup(BoundGroupHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    await commitIntoBound(h.fixture, h.inputs, END, '23:30');

    expect(h.host.model()).toEqual({
      start: at('2026-07-21', '21:00'),
      end: at('2026-07-21', '23:30'),
      duration: 2.5 * 3600,
    });
    expect(h.host.commits).toEqual([
      { start: at('2026-07-21', '21:00'), end: at('2026-07-21', '23:30'), duration: 2.5 * 3600 },
    ]);
  });

  it('a duration commit moves the end in the SAME composed write', async () => {
    const h = boundSetup(BoundGroupHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    await commitIntoBound(h.fixture, h.inputs, LENGTH, '2:00');

    expect(h.host.model()).toEqual({
      start: at('2026-07-21', '21:00'),
      end: at('2026-07-21', '23:00'),
      duration: 2 * 3600,
    });
  });

  it('the form value flows DOWN on external writes', async () => {
    const h = boundSetup(BoundGroupHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    h.host.model.set({
      start: at('2026-08-01', '08:00'),
      end: at('2026-08-01', '12:00'),
      duration: 4 * 3600,
    });
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.inputs().map((input) => input.value)).toEqual([
      'Aug 1, 2026',
      '08:00',
      '12:00',
      '4:00',
    ]);
  });

  it('shape-echo: a {start, end} binding never grows a duration key', async () => {
    const h = boundSetup(RangeOnlyHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    // The duration leaf still DISPLAYS the derived length…
    expect(h.inputs()[LENGTH].value).toBe('9:00');

    await commitIntoBound(h.fixture, h.inputs, END, '23:30');

    // …but the model echoes the bound shape: no duration key.
    expect(h.host.model()).toEqual({
      start: at('2026-07-21', '21:00'),
      end: at('2026-07-21', '23:30'),
    });
  });

  it('mixed mode throws: a field-bound leaf inside a field-bound group', () => {
    expect(() => {
      const fixture = TestBed.createComponent(MixedModeHost);
      fixture.detectChanges();
    }).toThrowError(/bind EITHER the group/);
  });
});
