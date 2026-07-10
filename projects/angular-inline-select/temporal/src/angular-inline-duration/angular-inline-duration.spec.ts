import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineDuration, type InlineDurationSaved } from './angular-inline-duration';
import {
  parseDuration,
  formatDuration,
  describeDuration,
  type DurationSavedDetails,
} from './duration-codec';

// =============================================================================
// Codec
// =============================================================================

describe('duration codec', () => {
  it('parses colon notation positionally by format', () => {
    expect(parseDuration('1:30', 'h:mm')).toBe(5400);
    expect(parseDuration('1:30', 'mm:ss')).toBe(90);
    expect(parseDuration('1:02:03', 'h:mm:ss')).toBe(3723);
  });

  it('parses unit tokens format-independently', () => {
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('45m')).toBe(2700);
    expect(parseDuration('1.5h')).toBe(5400);
    expect(parseDuration('90s')).toBe(90);
  });

  it('parses bare numbers as minutes (hour formats) or seconds (mm:ss)', () => {
    expect(parseDuration('90', 'h:mm')).toBe(5400);
    expect(parseDuration('90', 'mm:ss')).toBe(90);
  });

  it('empty is null, sexagesimal overflow and garbage are undefined', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('1:75')).toBeUndefined();
    expect(parseDuration('abc')).toBeUndefined();
  });

  it('formats seconds per format and describes them for the preview', () => {
    expect(formatDuration(5400, 'h:mm')).toBe('01:30');
    expect(formatDuration(3723, 'h:mm:ss')).toBe('01:02:03');
    expect(formatDuration(90, 'mm:ss')).toBe('01:30');
    expect(formatDuration(null)).toBe('');
    expect(describeDuration(5400)).toBe('1 h 30 min');
    expect(describeDuration(0)).toBe('0 s');
  });
});

// =============================================================================
// Component — the input rehost: one real input, gesture-tiered sessions
// =============================================================================

@Component({
  imports: [AngularInlineDuration, FormField],
  template: `
    <angular-inline-duration
      [formField]="field"
      [step]="60"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
    />
  `,
})
class DurationFormHost {
  model = signal<number | null>(5400);
  field = form(this.model);

  saved: DurationSavedDetails[] = [];
  sessions: InlineDurationSaved[] = [];
}

interface Harness {
  fixture: ComponentFixture<DurationFormHost>;
  host: DurationFormHost;
  input: () => HTMLInputElement;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(DurationFormHost);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    input: () =>
      fixture.nativeElement.querySelector('.inline-duration__input') as HTMLInputElement,
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

describe('AngularInlineDuration (input rehost)', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  afterEach(async () => {
    await blurAway(h);
  });

  it('renders the committed seconds in clock format in a real input', () => {
    expect(h.input().value).toBe('01:30');
  });

  it('Enter commits unit tokens as seconds, snapped to step', () => {
    type(h, '2h 15m');
    press(h, 'Enter');

    expect(h.host.saved.map((d) => d.duration)).toEqual([8100]);
    // The details decomposition rides along (2 h 15 min, zero-padded).
    expect(h.host.saved[0]).toEqual(
      expect.objectContaining({ hour: 2, minute: 15, second: 0, hourString: '02' }),
    );
    expect(h.host.sessions).toEqual([{ value: 8100, changed: true }]);
    expect(h.input().value).toBe('02:15'); // commits round-trip the codec
  });

  it('the parse gate blocks Enter on unreadable drafts', () => {
    type(h, '1:75');
    press(h, 'Enter');

    expect(h.host.saved).toEqual([]);
    expect(h.host.field().value()).toBe(5400);
    expect(h.input().getAttribute('aria-invalid')).toBe('true');
  });

  it('blur with an unreadable draft SNAPS BACK to the baseline', async () => {
    type(h, '1:75');
    await blurAway(h);

    expect(h.host.field().value()).toBe(5400);
    expect(h.input().value).toBe('01:30');
    expect(h.host.saved).toEqual([]);
    expect(h.host.sessions).toEqual([{ value: 5400, changed: false }]);
  });

  it('Escape reverts to the session baseline', () => {
    type(h, '2h');
    press(h, 'Escape');

    expect(h.host.field().value()).toBe(5400);
    expect(h.input().value).toBe('01:30');
    expect(h.host.saved).toEqual([]);
  });

  it('an empty draft commits null', () => {
    type(h, '');
    press(h, 'Enter');

    expect(h.host.field().value()).toBeNull();
    expect(h.host.sessions).toEqual([{ value: null, changed: true }]);
  });
});


// =============================================================================
// Visually-hidden safety — the phantom-scroll regression guard
// =============================================================================

describe('the aria-live announcer (visually hidden)', () => {
  it('is PINNED to its containing block — an offset-less absolute box keeps its static position and inflates a far-away scroller (the flex-table phantom-scroll bug)', () => {
    const h = setup();
    const sr = h.fixture.nativeElement.querySelector('.inline-duration__sr') as HTMLElement;
    expect(sr).not.toBeNull();

    const style = getComputedStyle(sr);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe('0px');
    expect(style.left).toBe('0px');
  });
});
