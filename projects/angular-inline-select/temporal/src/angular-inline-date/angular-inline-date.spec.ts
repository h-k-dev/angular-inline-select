import { Component, signal, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';

import { AngularInlineDate, type InlineDateSaved } from './angular-inline-date';
import {
  parseDateInput,
  formatIsoDate,
  formatInternalRange,
  buildDateCommands,
  toIsoDate,
  inferDateShape,
  toInternalRange,
  echoDateShape,
  dateValuesEqual,
  type InlineDateValue,
} from './date-codec';
import { dayToDbEntry, dayEndToDbEntry } from '../datetime/db-entry';
import { AngularInlineText } from 'angular-inline-select';

// The value contract: UTC ISO DB entries (local startOf/endOf day) behind,
// localized calendar days in front. Expectations compose through the same
// helpers, so specs are TZ-independent.
const db = dayToDbEntry;
const dbEnd = dayEndToDbEntry;

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

  it('the round-trip law: whatever the display formats, the parser accepts', () => {
    // The display's own outputs (medium + full), localized and English.
    expect(parseDateInput('Dec 24, 2026', NOW, 'en')).toBe('2026-12-24');
    expect(parseDateInput('Thursday, December 24, 2026', NOW, 'en')).toBe('2026-12-24');
    expect(parseDateInput('24. Dezember 2026', NOW, 'de')).toBe('2026-12-24');
    expect(parseDateInput('jun 07, 2024', NOW, 'en')).toBe('2024-06-07');
    expect(parseDateInput('7 june', NOW, 'en')).toBe('2026-06-07'); // year from now
    expect(parseDateInput('december 24', NOW, 'de')).toBe('2026-12-24'); // English always matches

    // Property: parse(format(day)) === day, per locale.
    for (const locale of ['en', 'de']) {
      for (const day of ['2026-01-31', '2026-07-04', '2024-02-29']) {
        expect(parseDateInput(formatIsoDate(day, locale), NOW, locale)).toBe(day);
      }
    }

    expect(parseDateInput('notamonth 12', NOW, 'en')).toBeUndefined();
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

describe('date shape-echo codec', () => {
  it('infers the shape from the bound value; null declares nothing', () => {
    expect(inferDateShape('2026-05-12')).toBe('single');
    expect(inferDateShape({ start: '2026-05-12' })).toBe('start-only');
    expect(inferDateShape({ start: '2026-05-12', end: '2026-05-15' })).toBe('range');
    expect(inferDateShape({ start: null, end: null })).toBe('range');
    expect(inferDateShape(null)).toBeNull();
  });

  it('normalizes every shape to the canonical internal range', () => {
    expect(toInternalRange('2026-05-12')).toEqual({ start: '2026-05-12', end: '2026-05-12' });
    // { start } is the single-day range [start, start]
    expect(toInternalRange({ start: '2026-05-12' })).toEqual({
      start: '2026-05-12',
      end: '2026-05-12',
    });
    expect(toInternalRange({ start: '2026-05-12', end: '2026-05-15' })).toEqual({
      start: '2026-05-12',
      end: '2026-05-15',
    });
    expect(toInternalRange(null)).toEqual({ start: null, end: null });
  });

  it('echoes the received shape, never inventing another one', () => {
    const single = { start: '2026-05-12', end: '2026-05-12' };
    expect(echoDateShape(single, 'single')).toBe('2026-05-12');
    expect(echoDateShape(single, 'start-only')).toEqual({ start: '2026-05-12' });
    expect(echoDateShape(single, 'range')).toEqual({ start: '2026-05-12', end: '2026-05-12' });
  });

  it('start-only keeps its one-key form until the data has a distinct end', () => {
    expect(echoDateShape({ start: '2026-05-12', end: '2026-05-12' }, 'start-only')).toEqual({
      start: '2026-05-12',
    });
    expect(echoDateShape({ start: '2026-05-12', end: '2026-05-15' }, 'start-only')).toEqual({
      start: '2026-05-12',
      end: '2026-05-15',
    });
  });

  it('dateValuesEqual compares structurally across shapes', () => {
    expect(dateValuesEqual('2026-05-12', '2026-05-12')).toBe(true);
    expect(dateValuesEqual({ start: '2026-05-12' }, { start: '2026-05-12' })).toBe(true);
    expect(dateValuesEqual({ start: '2026-05-12' }, '2026-05-12')).toBe(false);
    expect(
      dateValuesEqual({ start: '2026-05-12' }, { start: '2026-05-12', end: '2026-05-15' }),
    ).toBe(false);
    expect(dateValuesEqual(null, null)).toBe(true);
  });

  it('formats single days plainly and distinct ranges through formatRange', () => {
    expect(formatInternalRange({ start: '2026-05-12', end: '2026-05-12' }, 'en')).toBe(
      'May 12, 2026',
    );
    expect(formatInternalRange({ start: null, end: null }, 'en')).toBe('');

    const ranged = formatInternalRange({ start: '2026-05-12', end: '2026-05-15' }, 'en');
    expect(ranged).toContain('12');
    expect(ranged).toContain('15');
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
  model = signal<string | null>(db('2026-05-12'));
  field = form(this.model);
  now = () => NOW;

  saved: InlineDateValue[] = [];
  sessions: InlineDateSaved[] = [];
}

interface Harness<T = DateFormHost> {
  fixture: ComponentFixture<T>;
  host: T;
  display: () => HTMLElement;
  editor: () => HTMLElement | null;
  inner: () => AngularInlineText;
}

function setupHost<T>(type: Type<T>): Harness<T> {
  const fixture = TestBed.createComponent(type);
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

const setup = () => setupHost(DateFormHost);

async function typeText(h: Harness<unknown>, text: string) {
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

function accept(h: Harness<unknown>) {
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

    expect(h.host.saved).toEqual([db('2026-12-24')]);
    expect(h.host.sessions).toEqual([{ value: db('2026-12-24'), changed: true }]);
    expect(h.display().textContent).toBe('Dec 24, 2026');
  });

  it('the parse gate blocks impossible dates', async () => {
    await typeText(h, '31.2.2026');
    accept(h);

    expect(h.host.saved).toEqual([]);
    expect(h.host.field().value()).toBe(db('2026-05-12'));
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

// =============================================================================
// Polymorphic value — the shape-echo (ROADMAP-DATETIME.md)
// =============================================================================

@Component({
  imports: [AngularInlineDate],
  template: `
    <angular-inline-date
      [(value)]="value"
      [ranged]="ranged()"
      locale="en"
      [now]="now"
      (saved)="sessions.push($event)"
    />
  `,
})
class DateShapeHost {
  value = signal<InlineDateValue>(null);
  ranged = signal(false);
  now = () => NOW;

  sessions: InlineDateSaved[] = [];
}

describe('AngularInlineDate shape-echo', () => {
  async function commitDraft(h: Harness<DateShapeHost>, text: string) {
    await typeText(h, text);
    accept(h);
  }

  it('a string binding stays a string: single in, single out', async () => {
    const h = setupHost(DateShapeHost);
    h.host.value.set(db('2026-05-12'));
    h.fixture.detectChanges();

    await commitDraft(h, '24.12.2026');

    expect(h.host.value()).toBe(db('2026-12-24'));
  });

  it('{ start } echoes one-key: the single-day range moves whole', async () => {
    const h = setupHost(DateShapeHost);
    h.host.value.set({ start: db('2026-05-12') });
    h.fixture.detectChanges();

    expect(h.display().textContent).toBe('May 12, 2026');

    await commitDraft(h, '24.12.2026');

    expect(h.host.value()).toEqual({ start: db('2026-12-24') });
  });

  it('{ start, end } equal moves both sides with the typed day', async () => {
    const h = setupHost(DateShapeHost);
    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-12') });
    h.fixture.detectChanges();

    await commitDraft(h, '24.12.2026');

    expect(h.host.value()).toEqual({ start: db('2026-12-24'), end: dbEnd('2026-12-24') });
  });

  it('a distinct end survives a start edit; idle display shows the range', async () => {
    const h = setupHost(DateShapeHost);
    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    h.fixture.detectChanges();

    const idle = h.display().textContent ?? '';
    expect(idle).toContain('12');
    expect(idle).toContain('15');

    await commitDraft(h, '13.5.2026');

    expect(h.host.value()).toEqual({ start: db('2026-05-13'), end: dbEnd('2026-05-15') });
  });

  it('null + ranged=false cold-starts as a single date', async () => {
    const h = setupHost(DateShapeHost);

    await commitDraft(h, '24.12.2026');

    expect(h.host.value()).toBe(db('2026-12-24'));
  });

  it('null + ranged=true cold-starts in the range shape', async () => {
    const h = setupHost(DateShapeHost);
    h.host.ranged.set(true);
    h.fixture.detectChanges();

    await commitDraft(h, '24.12.2026');

    expect(h.host.value()).toEqual({ start: db('2026-12-24'), end: dbEnd('2026-12-24') });
  });

  it('null remembers the last seen shape: cleared one-key stays one-key', async () => {
    const h = setupHost(DateShapeHost);
    h.host.value.set({ start: db('2026-05-12') });
    h.fixture.detectChanges();

    await commitDraft(h, '');
    expect(h.host.value()).toEqual({ start: null });

    await commitDraft(h, '24.12.2026');
    expect(h.host.value()).toEqual({ start: db('2026-12-24') });
  });

  it('the saved session carries the echoed shape', async () => {
    const h = setupHost(DateShapeHost);
    h.host.value.set({ start: db('2026-05-12') });
    h.fixture.detectChanges();

    await commitDraft(h, '24.12.2026');

    expect(h.host.sessions).toEqual([{ value: { start: db('2026-12-24') }, changed: true }]);
  });
});

// =============================================================================
// T2 — the calendar overlay (open-on-edit, draft mirror, pick paths)
// =============================================================================

describe('AngularInlineDate calendar (T2)', () => {
  const calendar = () => document.querySelector('angular-inline-calendar');
  const grid = () => calendar()?.querySelector('.cal__grid') as HTMLElement | null;
  const activeCell = () => calendar()?.querySelector('[data-active]');

  it('opens on edit-session start WITHOUT stealing focus and mirrors the draft', async () => {
    const h = setup();
    await typeText(h, '24.12.2026');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(calendar()).not.toBeNull();
    // The caret stays in the field — the grid never takes focus on open.
    expect(calendar()!.contains(document.activeElement)).toBe(false);
    // The grid mirrors the parseable draft per keystroke.
    expect(activeCell()?.getAttribute('data-day')).toBe('2026-12-24');
    expect(calendar()!.querySelector('.cal__label')?.textContent).toContain('December');
  });

  it('an unparseable draft leaves the last valid day standing', async () => {
    const h = setup();
    await typeText(h, '24.12.2026');
    await typeText(h, 'garbage');
    h.fixture.detectChanges();

    expect(activeCell()?.getAttribute('data-day')).toBe('2026-12-24');
  });

  it('a pick while editing rewrites the live draft and closes the popup', async () => {
    const h = setup();
    await typeText(h, '12.5.2026');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    const cell = calendar()!.querySelector('[data-day="2026-05-15"]') as HTMLElement;
    cell.click();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.host.field().value()).toBe(db('2026-05-15')); // live channel followed
    expect(calendar()).toBeNull(); // popup collapsed
    expect(h.editor()).not.toBeNull(); // session still open
  });

  it('keyboard navigation crosses month edges (the transition dance)', async () => {
    const h = setup();
    await typeText(h, '31.5.2026');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    grid()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(activeCell()?.getAttribute('data-day')).toBe('2026-06-01');
    expect(calendar()!.querySelector('.cal__label')?.textContent).toContain('June');
  });

  it('Escape in the grid collapses the popup and keeps the session open', async () => {
    const h = setup();
    await typeText(h, '12.5.2026');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    grid()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    h.fixture.detectChanges();

    expect(calendar()).toBeNull();
    expect(h.editor()).not.toBeNull();
  });

  it('idle: the 📅 affix opens the grid and a pick COMMITS immediately', async () => {
    const h = setup();

    const trigger = h.fixture.nativeElement.querySelector('.date-trigger') as HTMLElement;
    trigger.click();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(calendar()).not.toBeNull();
    expect(activeCell()?.getAttribute('data-day')).toBe('2026-05-12'); // the committed day

    (calendar()!.querySelector('[data-day="2026-05-20"]') as HTMLElement).click();
    h.fixture.detectChanges();

    expect(h.host.saved).toEqual([db('2026-05-20')]);
    expect(h.host.sessions).toEqual([{ value: db('2026-05-20'), changed: true }]);
    expect(calendar()).toBeNull();
  });
});
