import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineTime, type InlineTimeSaved } from './angular-inline-time';
import { parseTime, parseTimeDraft, formatWallClock } from './time-codec';
import { composeDbEntry, localTimeOf, localDayOf } from '../datetime/db-entry';
import { AngularInlineText } from 'angular-inline-select';

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
// Component
// =============================================================================

@Component({
  imports: [AngularInlineTime, FormField],
  template: `
    <angular-inline-time
      [formField]="field"
      locale="de"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
    />
  `,
})
class TimeFormHost {
  model = signal<string | null>(at('09:30'));
  field = form(this.model);

  saved: (string | null)[] = [];
  sessions: InlineTimeSaved[] = [];
}

interface Harness {
  fixture: ComponentFixture<TimeFormHost>;
  host: TimeFormHost;
  display: () => HTMLElement;
  editor: () => HTMLElement | null;
  inner: () => AngularInlineText;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(TimeFormHost);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    display: () => fixture.nativeElement.querySelector('.editable-text__display') as HTMLElement,
    editor: () => document.querySelector('.editable-text__editor') as HTMLElement | null,
    inner: () =>
      fixture.debugElement.children[0].children[0].componentInstance as AngularInlineText,
  };
}

async function typeText(h: Harness, text: string) {
  const display = h.display();

  const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
  Object.defineProperty(event, 'inputType', { value: 'insertText' });
  Object.defineProperty(event, 'data', { value: 'x' });

  display.dispatchEvent(event);
  h.fixture.detectChanges();
  await h.fixture.whenStable();
  h.fixture.detectChanges();

  const editor = h.editor();
  if (!editor) throw new Error('elevated editor not found');

  editor.textContent = text;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function accept(h: Harness) {
  (h.inner() as unknown as { accept(): void }).accept();
  h.fixture.detectChanges();
}

describe('AngularInlineTime', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('renders the committed time localized', () => {
    expect(h.display().textContent).toBe('09:30');
  });

  it('commits typed drafts as DB entries anchored on the value own day', async () => {
    await typeText(h, '2105');

    const hint = document.querySelector('.editable-panel__message--hint');
    expect(hint?.textContent?.trim()).toBe('✓ 21:05');

    accept(h);

    expect(h.host.saved).toEqual([at('21:05')]);
    expect(h.host.sessions).toEqual([{ value: at('21:05'), changed: true, dayOverflow: 0 }]);
    expect(h.host.model()).toBe(at('21:05'));
    expect(localDayOf(h.host.model())).toBe(DAY); // the day survives the edit
  });

  it('the parse gate blocks impossible times', async () => {
    await typeText(h, '9:75');
    accept(h);

    expect(h.host.saved).toEqual([]);
    expect(h.host.field().value()).toBe(at('09:30'));
  });

  it('an OS-picker change while idle commits immediately', () => {
    const native = h.fixture.nativeElement.querySelector('.time-native') as HTMLInputElement;
    native.value = '14:45';
    native.dispatchEvent(new Event('change', { bubbles: true }));
    h.fixture.detectChanges();

    expect(h.host.model()).toBe(at('14:45'));
    expect(h.host.saved).toEqual([at('14:45')]);
    expect(h.host.sessions).toEqual([{ value: at('14:45'), changed: true, dayOverflow: 0 }]);
    expect(h.display().textContent).toBe('14:45');
  });

  it('an OS-picker change while editing replaces the draft without committing', async () => {
    await typeText(h, '9');

    const native = h.fixture.nativeElement.querySelector('.time-native') as HTMLInputElement;
    native.value = '10:15';
    native.dispatchEvent(new Event('change', { bubbles: true }));
    h.fixture.detectChanges();

    // Draft replaced, still an open session, nothing committed yet
    expect(h.host.saved).toEqual([]);
    expect(h.inner().editing()).toBe(true);
    expect(h.host.field().value()).toBe(at('10:15')); // live channel

    accept(h);
    expect(h.host.saved).toEqual([at('10:15')]);
  });

  it('an overflow draft commits onto the anchor day + n with a +n preview', async () => {
    await typeText(h, '24:30');

    const hint = document.querySelector('.editable-panel__message--hint');
    expect(hint?.textContent?.trim()).toBe('✓ 00:30 +1 day');

    accept(h);

    expect(h.host.model()).toBe(composeDbEntry('2026-07-22', '00:30'));
    expect(h.host.sessions).toEqual([
      { value: composeDbEntry('2026-07-22', '00:30'), changed: true, dayOverflow: 1 },
    ]);
  });

  it('a time typed into an EMPTY field anchors on the reference clock day', async () => {
    h.host.model.set(null);
    h.fixture.detectChanges();

    await typeText(h, '8');
    accept(h);

    const value = h.host.model();
    expect(localTimeOf(value)).toBe('08:00');
    expect(localDayOf(value)).toBe(localDayOf(new Date().toISOString()));
  });
});
