import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { AngularInlineDuration } from '../angular-inline-duration/angular-inline-duration';
import { composeDbEntry, dayToDbEntry, dayEndToDbEntry } from '../datetime/db-entry';
import {
  DateTimeRangeGroup,
  RangeDay,
  RangeStart,
  RangeEnd,
  RangeLength,
  type ComposedDateRange,
  type ComposedTimeRange,
} from './range-group';

const NOW = new Date(2026, 6, 21);

// Every value is a UTC ISO DB entry; expectations compose through the same
// helpers, so the specs are TZ-independent. The seed is an OVERNIGHT stay:
// 21 Jul 21:00 → 22 Jul 06:00, 9 h — the +1 lives IN the end value.
const at = (day: string, time: string) => composeDbEntry(day, time);

// The quartet fixture: stay · start · end · length.
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
    </div>
  `,
})
class QuartetHost {
  group = viewChild.required(DateTimeRangeGroup);

  day = signal<string | null>(dayToDbEntry('2026-07-21'));
  start = signal<string | null>(at('2026-07-21', '21:00'));
  end = signal<string | null>(at('2026-07-22', '06:00'));
  length = signal<number | null>(32_400);

  dateRanges: (ComposedDateRange | null)[] = [];
  timeRanges: (ComposedTimeRange | null)[] = [];
  durations: (number | null)[] = [];

  now = () => NOW;
}

interface Harness {
  fixture: ComponentFixture<QuartetHost>;
  host: QuartetHost;
  group: () => DateTimeRangeGroup;
  displays: () => HTMLElement[];
}

function setup(): Harness {
  const fixture = TestBed.createComponent(QuartetHost);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    group: () => fixture.componentInstance.group(),
    displays: () => [...fixture.nativeElement.querySelectorAll('.editable-text__display')],
  };
}

/** Elevate the field at `index`, type `text`, commit with the accept action. */
async function commitInto(h: Harness, index: number, text: string) {
  const display = h.displays()[index];

  const before = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
  Object.defineProperty(before, 'inputType', { value: 'insertText' });
  Object.defineProperty(before, 'data', { value: 'x' });
  display.dispatchEvent(before);
  h.fixture.detectChanges();
  await h.fixture.whenStable();
  h.fixture.detectChanges();

  const editor = document.querySelector('.editable-text__editor') as HTMLElement | null;
  if (!editor) throw new Error('elevated editor not found');

  editor.textContent = text;
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();

  editor.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  h.fixture.detectChanges();
  await h.fixture.whenStable();
  h.fixture.detectChanges();
}

// Field order in the template: 0 day · 1 start · 2 end · 3 length.
const START = 1;
const END = 2;
const LENGTH = 3;

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
