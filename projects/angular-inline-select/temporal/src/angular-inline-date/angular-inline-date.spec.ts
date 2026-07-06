import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineDate, type InlineDateSaved } from './angular-inline-date';
import { parseDateInput, formatIsoDate, buildDateCommands, toIsoDate } from './date-codec';
import { AngularInlineText } from 'angular-inline-select';

// A fixed "now" so the specs are deterministic: Tuesday, 12 May 2026.
const NOW = new Date(2026, 4, 12);

// =============================================================================
// Codec
// =============================================================================

describe('date codec', () => {
  it('parses dotted, slashed and ISO shapes', () => {
    expect(parseDateInput('12.5.2026', NOW)).toBe('2026-05-12');
    expect(parseDateInput('12.5.26', NOW)).toBe('2026-05-12');
    expect(parseDateInput('12/5/2026', NOW)).toBe('2026-05-12');
    expect(parseDateInput('2026-05-12', NOW)).toBe('2026-05-12');
  });

  it('year-less shapes take the year from now', () => {
    expect(parseDateInput('12.5.', NOW)).toBe('2026-05-12');
    expect(parseDateInput('12.5', NOW)).toBe('2026-05-12');
  });

  it('empty is null; impossible calendar dates and garbage are undefined', () => {
    expect(parseDateInput('', NOW)).toBeNull();
    expect(parseDateInput('31.2.2026', NOW)).toBeUndefined();
    expect(parseDateInput('12.13.2026', NOW)).toBeUndefined();
    expect(parseDateInput('soon', NOW)).toBeUndefined();
  });

  it('formats ISO dates through Intl', () => {
    expect(formatIsoDate('2026-05-12', 'en')).toBe('May 12, 2026');
    expect(formatIsoDate(null)).toBe('');
  });

  it('builds relative + weekday commands with localized and English matching', () => {
    const commands = buildDateCommands(NOW, 'de');

    const today = commands.find((command) => command.id === 'ai-date-today');
    expect(today?.iso).toBe('2026-05-12');
    expect(today?.match).toContain('today'); // English basis survives any locale
    expect(today?.label.toLowerCase()).toBe('heute');

    // 3 relatives + 7 weekdays, all resolving to real dates
    expect(commands).toHaveLength(10);
    expect(commands.every((command) => /^\d{4}-\d{2}-\d{2}$/.test(command.iso))).toBe(true);
  });

  it('toIsoDate is timezone-free calendar math', () => {
    expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

// =============================================================================
// Component
// =============================================================================

@Component({
  imports: [AngularInlineDate, FormField],
  template: `
    <angular-inline-date
      [formField]="field"
      locale="en"
      [now]="now"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
    />
  `,
})
class DateFormHost {
  model = signal<string | null>('2026-05-12');
  field = form(this.model);
  now = () => NOW;

  saved: (string | null)[] = [];
  sessions: InlineDateSaved[] = [];
}

interface Harness {
  fixture: ComponentFixture<DateFormHost>;
  host: DateFormHost;
  display: () => HTMLElement;
  editor: () => HTMLElement | null;
  inner: () => AngularInlineText;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(DateFormHost);
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

  // Caret at the end, as real typing would leave it (the slash menu reads it)
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function accept(h: Harness) {
  (h.inner() as unknown as { accept(): void }).accept();
  h.fixture.detectChanges();
}

describe('AngularInlineDate', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('renders the committed ISO date localized', () => {
    expect(h.display().textContent).toBe('May 12, 2026');
  });

  it('commits typed drafts as ISO with a full-reading preview', async () => {
    await typeText(h, '24.12.2026');

    const hint = document.querySelector('.editable-panel__message--hint');
    expect(hint?.textContent?.trim()).toBe('✓ Thursday, December 24, 2026');

    accept(h);

    expect(h.host.saved).toEqual(['2026-12-24']);
    expect(h.host.sessions).toEqual([{ value: '2026-12-24', changed: true }]);
    expect(h.display().textContent).toBe('Dec 24, 2026');
  });

  it('the parse gate blocks impossible dates', async () => {
    await typeText(h, '31.2.2026');
    accept(h);

    expect(h.host.saved).toEqual([]);
    expect(h.host.field().value()).toBe('2026-05-12');
  });

  it('the /tomorrow slash command inserts the resolved ISO date', async () => {
    await typeText(h, '/tomo');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    const options = [...document.querySelectorAll('.editable-menu [role="option"]')];
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain('2026-05-13');

    (options[0] as HTMLElement).click();
    h.fixture.detectChanges();

    expect(h.editor()?.textContent).toBe('2026-05-13');
    // The preview now interprets the inserted date
    expect(document.querySelector('.editable-panel__message--hint')?.textContent?.trim()).toBe(
      '✓ Wednesday, May 13, 2026',
    );
  });
});
