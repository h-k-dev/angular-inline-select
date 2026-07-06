import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineDuration, type InlineDurationSaved } from './angular-inline-duration';
import { parseDuration, formatDuration, describeDuration } from './duration-codec';
import { AngularInlineText } from 'angular-inline-select';

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
    expect(formatDuration(5400, 'h:mm')).toBe('1:30');
    expect(formatDuration(3723, 'h:mm:ss')).toBe('1:02:03');
    expect(formatDuration(90, 'mm:ss')).toBe('1:30');
    expect(formatDuration(null)).toBe('');
    expect(describeDuration(5400)).toBe('1 h 30 min');
    expect(describeDuration(0)).toBe('0 s');
  });
});

// =============================================================================
// Component
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

  saved: (number | null)[] = [];
  sessions: InlineDurationSaved[] = [];
}

interface Harness {
  fixture: ComponentFixture<DurationFormHost>;
  host: DurationFormHost;
  display: () => HTMLElement;
  editor: () => HTMLElement | null;
  inner: () => AngularInlineText;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(DurationFormHost);
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

describe('AngularInlineDuration', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('renders the committed seconds in clock format', () => {
    expect(h.display().textContent).toBe('1:30');
  });

  it('commits unit tokens as seconds, snapped to step, with a live preview', async () => {
    await typeText(h, '2h 15m');

    const hint = document.querySelector('.editable-panel__message--hint');
    expect(hint?.textContent?.trim()).toBe('✓ 2 h 15 min');

    accept(h);

    expect(h.host.saved).toEqual([8100]);
    expect(h.host.sessions).toEqual([{ value: 8100, changed: true }]);
    expect(h.display().textContent).toBe('2:15');
  });

  it('the parse gate blocks unreadable drafts', async () => {
    await typeText(h, '1:75');
    accept(h);

    expect(h.host.saved).toEqual([]);
    expect(h.host.field().value()).toBe(5400);
  });

  it('an empty draft commits null', async () => {
    await typeText(h, '');
    accept(h);

    expect(h.host.field().value()).toBeNull();
    expect(h.host.sessions).toEqual([{ value: null, changed: true }]);
  });
});
