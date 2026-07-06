import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { AngularInlineDuration } from '../angular-inline-duration/angular-inline-duration';
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

// The quartet fixture: stay · start · end · length, seeded overnight.
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
      <angular-inline-time rangeStart [(value)]="start" locale="en-u-hc-h23" />
      <angular-inline-time rangeEnd [(value)]="end" locale="en-u-hc-h23" />
      <angular-inline-duration rangeLength [(value)]="length" />
    </div>
  `,
})
class QuartetHost {
  group = viewChild.required(DateTimeRangeGroup);

  day = signal<string | null>('2026-07-21');
  start = signal<string | null>('21:00');
  end = signal<string | null>('06:00');
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
    expect(h.group().start()).toBe('21:00');
    expect(h.group().end()).toBe('06:00');
    expect(h.group().length()).toBe(32_400);
  });

  it('the overnight seed wears the +1 badge on the end field', () => {
    expect(h.group().endDayOffset()).toBe(1);

    const badges = [...h.fixture.nativeElement.querySelectorAll('.time-day-badge')];
    expect(badges.map((badge) => badge.textContent?.trim())).toEqual(['+1']);
  });

  it('committing an end recomputes the duration and drops the badge same-day', async () => {
    await commitInto(h, END, '23:30');

    expect(h.host.end()).toBe('23:30');
    expect(h.host.length()).toBe(2.5 * 3600); // 21:00 → 23:30
    expect(h.group().endDayOffset()).toBe(0);
    expect(h.fixture.nativeElement.querySelector('.time-day-badge')).toBeNull();
  });

  it('an end at or before the start reads as next-day (+24 h wrap)', async () => {
    await commitInto(h, END, '21:00');

    expect(h.host.length()).toBe(24 * 3600);
    expect(h.group().endDayOffset()).toBe(1);
  });

  it('committing a duration MOVES the end; multi-day lengths grow the badge', async () => {
    await commitInto(h, LENGTH, '2:00');
    expect(h.host.end()).toBe('23:00');
    expect(h.group().endDayOffset()).toBe(0);

    await commitInto(h, LENGTH, '30h');
    expect(h.host.end()).toBe('03:00'); // 21:00 + 30 h = two calendar days later
    expect(h.group().endDayOffset()).toBe(2);
  });

  it('committing a start keeps the end and follows with the duration', async () => {
    await commitInto(h, START, '22:00');

    expect(h.host.end()).toBe('06:00');
    expect(h.host.length()).toBe(8 * 3600); // 22:00 → 06:00 overnight
    expect(h.group().endDayOffset()).toBe(1);
  });

  it('day edits shift the stay without touching times or duration', async () => {
    await commitInto(h, 0, '22.7.2026');

    expect(h.host.day()).toBe('2026-07-22');
    expect(h.host.start()).toBe('21:00');
    expect(h.host.end()).toBe('06:00');
    expect(h.host.length()).toBe(32_400);
  });

  it('composes the date range with the over-count applied', () => {
    // Seed: day 2026-07-21, offset +1 → the end DATE is the next day.
    expect(h.group().dateRange()).toEqual({ start: '2026-07-21', end: '2026-07-22' });
    expect(h.group().timeRange()).toEqual({ start: '21:00', end: '06:00' });
  });

  it('emits the composed streams per commit — only the ones that changed', async () => {
    // End 23:30: same-day now — date range loses the +1, time range and duration move.
    await commitInto(h, END, '23:30');

    expect(h.host.dateRanges).toEqual([{ start: '2026-07-21', end: '2026-07-21' }]);
    expect(h.host.timeRanges).toEqual([{ start: '21:00', end: '23:30' }]);
    expect(h.host.durations).toEqual([2.5 * 3600]);

    // Length 30h: end moves to 03:00, over-count +2 → end date two days out.
    await commitInto(h, LENGTH, '30h');

    expect(h.host.dateRanges[1]).toEqual({ start: '2026-07-21', end: '2026-07-23' });
    expect(h.host.timeRanges[1]).toEqual({ start: '21:00', end: '03:00' });
    expect(h.host.durations[1]).toBe(30 * 3600);
  });

  it('day commits emit only the date range — times and duration are untouched', async () => {
    await commitInto(h, 0, '22.7.2026');

    expect(h.host.dateRanges).toEqual([{ start: '2026-07-22', end: '2026-07-23' }]);
    expect(h.host.timeRanges).toEqual([]);
    expect(h.host.durations).toEqual([]);
  });

  it('group writes flow through value, never emitting saved on the written control', async () => {
    let endSessions = 0;
    const endControl = h.fixture.debugElement.children[0].children[2]
      .componentInstance as AngularInlineTime;
    endControl.saved.subscribe(() => endSessions++);

    await commitInto(h, LENGTH, '3:00');

    expect(h.host.end()).toBe('00:00');
    expect(endSessions).toBe(0);
  });
});
