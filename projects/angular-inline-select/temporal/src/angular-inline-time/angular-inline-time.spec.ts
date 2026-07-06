import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineTime, type InlineTimeSaved } from './angular-inline-time';
import { parseTime, formatWallClock } from './time-codec';
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
    expect(parseTime('25:00')).toBeUndefined();
    expect(parseTime('9:75')).toBeUndefined();
    expect(parseTime('soon')).toBeUndefined();
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
    expect(h.host.sessions).toEqual([{ value: at('21:05'), changed: true }]);
    expect(h.host.model()).toBe(at('21:05'));
    expect(localDayOf(h.host.model())).toBe(DAY); // the day survives the edit
  });

  it('the parse gate blocks impossible times', async () => {
    await typeText(h, '25:00');
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
    expect(h.host.sessions).toEqual([{ value: at('14:45'), changed: true }]);
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
