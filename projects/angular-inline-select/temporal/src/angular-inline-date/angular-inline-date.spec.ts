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
  localeDatePlaceholder,
  type DateSavedDetails,
  type InlineDateValue,
} from './date-codec';
import { dayToDbEntry, dayEndToDbEntry, localDayOf } from '../datetime/db-entry';

// The value contract: UTC ISO DB entries (local startOf/endOf day) behind,
// localized calendar days in front. Expectations compose through the same
// helpers, so specs are TZ-independent.
const db = dayToDbEntry;

/** The commit payloads' start sides, back as local days (spec convenience). */
const savedStartDays = (details: DateSavedDetails[]) =>
  details.map((d) => d.start?.toFormat('yyyy-MM-dd') ?? null);
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

  it('a FULL ISO datetime decomposes to its LOCAL day (the paste gesture)', () => {
    expect(parseDateInput('2026-05-12T08:00', NOW)).toBe('2026-05-12');
    expect(parseDateInput('2026-05-12 08:00', NOW)).toBe('2026-05-12');
    // Zoned instants read in the LOCAL zone — expectation composed, TZ-independent.
    expect(parseDateInput('2026-05-12T21:00:00.000Z', NOW)).toBe(
      localDayOf('2026-05-12T21:00:00.000Z'),
    );
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

  it('derives the placeholder pattern from the locale — fixed size, no tables', () => {
    expect(localeDatePlaceholder('de')).toBe('dd.mm.yyyy');
    expect(localeDatePlaceholder('en')).toBe('mm/dd/yyyy');
    expect(localeDatePlaceholder('en-GB')).toBe('dd/mm/yyyy');
    // An unknown tag throws inside Intl — the ISO fallback stands.
    expect(localeDatePlaceholder('no-such-tag-!!')).toBe('yyyy-mm-dd');
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
// Component — the input rehost: real inputs, gesture-tiered sessions
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

  saved: DateSavedDetails[] = [];
  sessions: InlineDateSaved[] = [];
}

@Component({
  imports: [AngularInlineDate],
  template: `
    <angular-inline-date
      [(value)]="value"
      [ranged]="ranged()"
      [placeholder]="placeholder()"
      locale="en"
      [now]="now"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
    />
  `,
})
class DateShapeHost {
  value = signal<InlineDateValue>(null);
  ranged = signal(false);
  placeholder = signal<string | undefined>(undefined);
  now = () => NOW;

  saved: DateSavedDetails[] = [];
  sessions: InlineDateSaved[] = [];
}

interface Harness<T> {
  fixture: ComponentFixture<T>;
  host: T;
  inputs: () => HTMLInputElement[];
  start: () => HTMLInputElement;
  end: () => HTMLInputElement | undefined;
  panel: () => HTMLElement | null;
}

function setupHost<T>(type: Type<T>): Harness<T> {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();

  const inputs = () =>
    [...fixture.nativeElement.querySelectorAll('.inline-date__input')] as HTMLInputElement[];

  return {
    fixture,
    host: fixture.componentInstance,
    inputs,
    start: () => inputs()[0],
    end: () => inputs()[1],
    panel: () => document.querySelector('.inline-date__panel') as HTMLElement | null,
  };
}

/** Focus settlement runs a macrotask behind (`setTimeout(0)`) — flush it. */
async function settle(h: Harness<unknown>) {
  h.fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  h.fixture.detectChanges();
}

function focusInput(h: Harness<unknown>, input: HTMLInputElement) {
  input.focus();
  h.fixture.detectChanges();
}

function type(h: Harness<unknown>, input: HTMLInputElement, text: string) {
  focusInput(h, input);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function press(h: Harness<unknown>, input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  h.fixture.detectChanges();
}

async function blurAway(h: Harness<unknown>) {
  (document.activeElement as HTMLElement | null)?.blur();
  await settle(h);
}

function gridCell(day: string): HTMLElement | null {
  return document.querySelector(`.inline-date__panel [data-day="${day}"]`);
}

describe('AngularInlineDate (input rehost)', () => {
  let h: Harness<DateFormHost>;

  beforeEach(() => {
    h = setupHost(DateFormHost);
  });

  afterEach(async () => {
    await blurAway(h);
  });

  it('renders the committed date in ONE real input (string shape)', () => {
    expect(h.inputs().length).toBe(1);
    expect(h.start().value).toBe('May 12, 2026');
  });

  it('the calendar trigger is click-only — out of the tab order (focus already opens the panel)', () => {
    const trigger = h.fixture.nativeElement.querySelector(
      '.inline-date__trigger',
    ) as HTMLButtonElement | null;
    expect(trigger?.getAttribute('tabindex')).toBe('-1');
  });

  it('focus opens the panel WITHOUT stealing focus; the grid mirrors the draft', async () => {
    focusInput(h, h.start());

    expect(h.panel()).not.toBeNull();
    expect(document.activeElement).toBe(h.start());

    type(h, h.start(), '24.12.2026');
    expect(gridCell('2026-12-24')?.getAttribute('data-active')).toBe('true');

    // An unparseable draft leaves the last valid day standing.
    type(h, h.start(), '24.12.2026x');
    expect(gridCell('2026-12-24')?.getAttribute('data-active')).toBe('true');
  });

  it('Enter commits the typed draft with a full-reading preview, and closes the panel', async () => {
    type(h, h.start(), '24.12.2026');

    expect(document.querySelector('.inline-date__preview')?.textContent?.trim()).toBe(
      'Thursday, December 24, 2026',
    );

    press(h, h.start(), 'Enter');

    expect(savedStartDays(h.host.saved)).toEqual(['2026-12-24']);
    expect(h.host.sessions).toEqual([{ value: db('2026-12-24'), changed: true }]);
    expect(h.start().value).toBe('Dec 24, 2026');
    expect(h.panel()).toBeNull();
    // Focus stays — Enter never traps NOR moves it.
    expect(document.activeElement).toBe(h.start());
  });

  it('the parse gate blocks Enter on an unreadable draft', () => {
    type(h, h.start(), '31.2.2026');
    press(h, h.start(), 'Enter');

    expect(h.host.saved).toEqual([]);
    expect(h.host.sessions).toEqual([]);
    expect(h.host.field().value()).toBe(db('2026-05-12'));
    expect(h.start().getAttribute('aria-invalid')).toBe('true');
  });

  it('blur with an unreadable draft SNAPS BACK to the baseline — never traps, never commits', async () => {
    // A readable intermediate wrote live; the garbage suffix must still
    // revert to the SESSION baseline, not the intermediate.
    type(h, h.start(), '24.12.2026');
    expect(h.host.field().value()).toBe(db('2026-12-24')); // live channel
    type(h, h.start(), '24.12.2026x');
    await blurAway(h);

    expect(h.host.field().value()).toBe(db('2026-05-12'));
    expect(h.start().value).toBe('May 12, 2026');
    expect(h.host.saved).toEqual([]);
    expect(h.host.sessions).toEqual([{ value: db('2026-05-12'), changed: false }]);
    expect(h.panel()).toBeNull();
  });

  it('blur with a readable draft COMMITS (navigation is never a validity checkpoint)', async () => {
    type(h, h.start(), '24.12.2026');
    await blurAway(h);

    expect(savedStartDays(h.host.saved)).toEqual(['2026-12-24']);
    expect(h.host.sessions).toEqual([{ value: db('2026-12-24'), changed: true }]);
  });

  it('Escape reverts to the session baseline and closes the panel', () => {
    type(h, h.start(), '24.12.2026');
    press(h, h.start(), 'Escape');

    expect(h.host.field().value()).toBe(db('2026-05-12'));
    expect(h.start().value).toBe('May 12, 2026');
    expect(h.host.saved).toEqual([]);
    expect(h.panel()).toBeNull();
  });

  it('clearing the field commits null', async () => {
    type(h, h.start(), '');
    press(h, h.start(), 'Enter');

    expect(h.host.field().value()).toBeNull();
    expect(savedStartDays(h.host.saved)).toEqual([null]);
  });

  it('ArrowDown hands focus to the grid; a pick COMMITS; grid Escape hands it back', async () => {
    focusInput(h, h.start());
    press(h, h.start(), 'ArrowDown');

    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute('data-day')).toBe('2026-05-12');

    active.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    h.fixture.detectChanges();
    expect(document.activeElement).toBe(h.start());

    const cell = gridCell('2026-05-20')!;
    cell.click();
    await settle(h);

    expect(savedStartDays(h.host.saved)).toEqual(['2026-05-20']);
    expect(h.start().value).toBe('May 20, 2026');
    expect(h.panel()).toBeNull();
    expect(document.activeElement).toBe(h.start());
  });

  it('a quick-pick chip commits its resolved date', async () => {
    focusInput(h, h.start());

    const chips = [...document.querySelectorAll('.inline-date__quick-pick')];
    expect(chips.length).toBe(3);

    (chips[2] as HTMLElement).click(); // tomorrow
    await settle(h);

    expect(savedStartDays(h.host.saved)).toEqual(['2026-05-13']);
  });
});

// =============================================================================
// The two-field range — shape-echo, Tab-advance, per-side clear
// =============================================================================

@Component({
  imports: [AngularInlineDate],
  template: ` <angular-inline-date [(value)]="value" locale="en" zone="Asia/Tokyo" [now]="now" /> `,
})
class ZonedDateHost {
  value = signal<InlineDateValue>(dayToDbEntry('2026-07-21', 'Asia/Tokyo'));
  now = () => NOW;
}

describe('AngularInlineDate with a display zone (T6)', () => {
  it('speaks the ZONE calendar day at the value boundary', () => {
    const h = setupHost(ZonedDateHost);

    // Tokyo's Jul 21 — whatever day the machine zone thinks this instant is.
    expect(h.start().value).toBe('Jul 21, 2026');

    type(h, h.start(), '24.12.2026');
    press(h, h.start(), 'Enter');

    expect(h.host.value()).toBe(dayToDbEntry('2026-12-24', 'Asia/Tokyo'));
    h.start().blur();
  });
});

describe('AngularInlineDate two-field range', () => {
  let h: Harness<DateShapeHost>;

  beforeEach(() => {
    h = setupHost(DateShapeHost);
  });

  afterEach(async () => {
    await blurAway(h);
  });

  it('a string binding renders one field; object shapes render the pair', () => {
    h.host.value.set(db('2026-05-12'));
    h.fixture.detectChanges();
    expect(h.inputs().length).toBe(1);

    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    h.fixture.detectChanges();
    expect(h.inputs().length).toBe(2);
    expect(h.start().value).toBe('May 12, 2026');
    expect(h.end()!.value).toBe('May 15, 2026');
  });

  it('null + ranged=true cold-starts as the pair, both hinting the locale pattern', () => {
    h.host.ranged.set(true);
    h.fixture.detectChanges();

    expect(h.inputs().length).toBe(2);
    expect(h.start().placeholder).toBe('mm/dd/yyyy');
    expect(h.end()!.placeholder).toBe('mm/dd/yyyy');
  });

  it('a half-open range switches the empty end side to the … placeholder', () => {
    h.host.ranged.set(true);
    h.host.value.set({ start: db('2026-05-12'), end: null });
    h.fixture.detectChanges();

    expect(h.end()!.placeholder).toBe('…');
  });

  it('an explicit placeholder input overrides the locale pattern on both sides', () => {
    h.host.ranged.set(true);
    h.host.placeholder.set('when?');
    h.fixture.detectChanges();

    expect(h.start().placeholder).toBe('when?');
    expect(h.end()!.placeholder).toBe('when?');
  });

  it('Tab-advance: focus moving start → end settles the start (commit-valid)', async () => {
    h.host.ranged.set(true);
    h.fixture.detectChanges();

    type(h, h.start(), '12.5.2026');
    focusInput(h, h.end()!); // what Tab does
    await settle(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-12'), end: null });
    expect(h.host.sessions).toEqual([
      { value: { start: db('2026-05-12'), end: null }, changed: true },
    ]);

    type(h, h.end()!, '15.5.2026');
    await blurAway(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    expect(h.host.sessions.length).toBe(2);
  });

  it('each side owns its clear — the other side is NEVER nuked', async () => {
    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    h.fixture.detectChanges();

    type(h, h.end()!, '');
    press(h, h.end()!, 'Enter');
    expect(h.host.value()).toEqual({ start: db('2026-05-12'), end: null });

    type(h, h.start(), '');
    press(h, h.start(), 'Enter');
    expect(h.host.value()).toEqual({ start: null, end: null });
  });

  it('a typed end BEFORE the start commits the SORTED pair (the calendar-pick law)', async () => {
    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    h.fixture.detectChanges();

    type(h, h.end()!, '2026-05-08');
    press(h, h.end()!, 'Enter');

    // Days carry no overnight reading (that is the TIME control's roll) —
    // backwards just sorts, exactly like an inverted calendar pick.
    expect(h.host.value()).toEqual({ start: db('2026-05-08'), end: dbEnd('2026-05-12') });
    expect(h.start().value).toBe('May 8, 2026');
    expect(h.end()!.value).toBe('May 12, 2026');
    expect(h.host.sessions.at(-1)!.changed).toBe(true);
  });

  it('Tab-advance settles the departing side BEFORE the landing session baselines — Escape never resurrects a pre-sort pair', async () => {
    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    h.fixture.detectChanges();

    type(h, h.end()!, '2026-05-08'); // live channel: inverted, not yet sorted
    focusInput(h, h.start()); // what Tab does — the end settles NOW and sorts
    h.fixture.detectChanges();

    const sorted = { start: db('2026-05-08'), end: dbEnd('2026-05-12') };
    expect(h.host.value()).toEqual(sorted);

    // The start session's baseline is the POST-sort day — Escape is a no-op.
    press(h, h.start(), 'Escape');
    await settle(h);
    expect(h.host.value()).toEqual(sorted);
  });

  it('a start edit in the one-key { start } shape moves the single-day range whole', async () => {
    h.host.value.set({ start: db('2026-05-12') });
    h.fixture.detectChanges();

    type(h, h.start(), '20.5.2026');
    press(h, h.start(), 'Enter');

    expect(h.host.value()).toEqual({ start: db('2026-05-20') });

    // Only an END edit creates a distinct end (and grows the key).
    type(h, h.end()!, '25.5.2026');
    press(h, h.end()!, 'Enter');

    expect(h.host.value()).toEqual({ start: db('2026-05-20'), end: dbEnd('2026-05-25') });
  });

  it('null remembers the last seen shape: a cleared one-key field stays one-key', async () => {
    h.host.value.set({ start: db('2026-05-12') });
    h.fixture.detectChanges();

    type(h, h.start(), '');
    press(h, h.start(), 'Enter');

    expect(h.host.value()).toEqual({ start: null });
    expect(h.inputs().length).toBe(2);
  });

  it('press-hold-drag paints the range live and commits it whole — ONE saved', async () => {
    h.host.ranged.set(true);
    h.fixture.detectChanges();

    focusInput(h, h.start());
    const cellA = gridCell('2026-05-06')!;
    cellA.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    h.fixture.detectChanges();
    gridCell('2026-05-09')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    h.fixture.detectChanges();

    // The live preview paints between the endpoints while dragging.
    expect(cellA.hasAttribute('data-range-start')).toBe(true);
    expect(gridCell('2026-05-07')?.hasAttribute('data-in-range')).toBe(true);

    document.dispatchEvent(new MouseEvent('mouseup'));
    await settle(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-06'), end: dbEnd('2026-05-09') });
    expect(h.host.sessions).toEqual([
      { value: { start: db('2026-05-06'), end: dbEnd('2026-05-09') }, changed: true },
    ]);
    expect(h.panel()).toBeNull();
  });

  it('a reversed drag sorts; Ctrl+click restarts the range half-open', async () => {
    h.host.value.set({ start: db('2026-05-12'), end: dbEnd('2026-05-15') });
    h.fixture.detectChanges();

    focusInput(h, h.start());
    // Ctrl+click: start = the day, the end CLEARS (a committed half-open range).
    gridCell('2026-05-20')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    );
    await settle(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-20'), end: null });
    expect(document.activeElement).toBe(h.end()!);
    expect(h.panel()).not.toBeNull(); // stays open for the completing pick

    // A reversed drag (25 → 22) commits sorted.
    gridCell('2026-05-25')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 }),
    );
    gridCell('2026-05-22')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    await settle(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-22'), end: dbEnd('2026-05-25') });
  });

  it('range picking: first pick fills the focused side and hands the session to the empty side', async () => {
    h.host.ranged.set(true);
    h.fixture.detectChanges();

    focusInput(h, h.start());
    gridCell('2026-05-20')!.click();
    await settle(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-20'), end: null });
    expect(document.activeElement).toBe(h.end()!);
    expect(h.panel()).not.toBeNull(); // the popup stays for the second pick

    gridCell('2026-05-12')!.click(); // BEFORE the start: the pair sorts
    await settle(h);

    expect(h.host.value()).toEqual({ start: db('2026-05-12'), end: dbEnd('2026-05-20') });
    // BOTH inputs display the SORTED pair (the picked side re-baselines on
    // its swapped day — a later blur must not un-sort it).
    expect(h.start().value).toBe('May 12, 2026');
    expect(h.end()!.value).toBe('May 20, 2026');
    expect(h.panel()).toBeNull();
  });
});

// =============================================================================
// Visually-hidden safety — the phantom-scroll regression guard
// =============================================================================

describe('the aria-live announcer (visually hidden)', () => {
  it('is PINNED to its containing block — an offset-less absolute box keeps its static position and inflates a far-away scroller (the flex-table phantom-scroll bug)', () => {
    const h = setupHost(DateFormHost);
    const sr = h.fixture.nativeElement.querySelector('.inline-date__sr') as HTMLElement;
    expect(sr).not.toBeNull();

    const style = getComputedStyle(sr);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe('0px');
    expect(style.left).toBe('0px');
  });
});
