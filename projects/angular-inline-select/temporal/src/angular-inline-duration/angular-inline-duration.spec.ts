import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, required } from '@angular/forms/signals';

import { AngularInlineDuration, type InlineDurationSaved } from './angular-inline-duration';
import type { IntervalRounding } from '../interval-rounding';
import { EditableClear, EditableClearTemplate } from 'angular-inline-select';
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
      [intervalStep]="60"
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
    input: () => fixture.nativeElement.querySelector('.inline-duration__input') as HTMLInputElement,
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

// =============================================================================
// Clear affordance — the consumer's own button
// =============================================================================

@Component({
  imports: [AngularInlineDuration, EditableClear, EditableClearTemplate],
  template: `
    <angular-inline-duration [(value)]="value" (saved)="sessions.push($event)">
      <ng-template editableClear let-clear let-label="label" let-side="side">
        <button
          editableClear
          class="confirm-clear"
          [attr.aria-label]="label"
          [attr.data-side]="side"
          (clear)="request(clear)"
        >
          ✕
        </button>
      </ng-template>
    </angular-inline-duration>
  `,
})
class DurationClearHost {
  value = signal<number | null>(5400);
  sessions: InlineDurationSaved[] = [];

  /** Stands in for a confirmation dialog: capture the callback, resolve later. */
  pending: (() => void) | null = null;

  request(clear: () => void) {
    this.pending = clear;
  }
}

describe('AngularInlineDuration — clear affordance', () => {
  it('stamps the consumer template and hands the commit over', () => {
    const fixture = TestBed.createComponent(DurationClearHost);
    fixture.detectChanges();

    fixture.nativeElement
      .querySelector('.inline-duration')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    const button = document.querySelector<HTMLButtonElement>(
      '.editable-bubble button.confirm-clear',
    );
    expect(button).not.toBeNull();
    // Single-valued: no side to distinguish, and the label names the field.
    expect(button!.getAttribute('data-side')).toBeNull();
    expect(button!.getAttribute('aria-label')).toBe('Clear duration');

    button!.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    const host = fixture.componentInstance;
    expect(host.value()).toBe(5400);

    host.pending!();
    fixture.detectChanges();

    expect(host.value()).toBeNull();
    expect(host.sessions).toEqual([{ value: null, changed: true }]);
  });
});

// =============================================================================
// The interactive unit — a press on the wrapper's own space lands in the input
// =============================================================================

describe('AngularInlineDuration — the interactive unit', () => {
  it('a press in the unit outside the input focuses it and opens the session', () => {
    const h = setup();
    const unit = h.fixture.nativeElement.querySelector('.inline-duration') as HTMLElement;
    expect(unit.classList.contains('editable-unit')).toBe(true);

    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 400,
      clientY: 8,
    });
    unit.dispatchEvent(event);
    h.fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(h.input());
    expect(h.input().selectionStart).toBe(h.input().value.length);
  });
});

// =============================================================================
// The rounding grid — `intervalStep` / `intervalRounding` on the committed length
// =============================================================================

@Component({
  imports: [AngularInlineDuration, FormField],
  template: `
    <angular-inline-duration
      [formField]="field"
      [intervalStep]="900"
      [intervalRounding]="rounding()"
    />
  `,
})
class DurationGridHost {
  model = signal<number | null>(null);
  field = form(this.model, (path) => required(path, { when: () => this.required() }));
  rounding = signal<IntervalRounding>('ceil');
  required = signal(false);
}

describe('AngularInlineDuration — the rounding grid', () => {
  function commit(text: string, setup?: (host: DurationGridHost) => void) {
    const fixture = TestBed.createComponent(DurationGridHost);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.inline-duration__input') as HTMLInputElement;
    input.focus();
    fixture.detectChanges();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    return fixture.componentInstance.model();
  }

  it("'ceil' (the default) lands the length UP — 16 min → 30 min", () => {
    expect(commit('16m')).toBe(30 * 60);
  });

  it("'round' lands on the NEAREST multiple — 22 min → 15 min", () => {
    expect(commit('22m', (h) => h.rounding.set('round'))).toBe(15 * 60);
  });

  it("'floor' lands DOWN — 29 min → 15 min", () => {
    expect(commit('29m', (h) => h.rounding.set('floor'))).toBe(15 * 60);
  });

  it('a required-but-shorter length settles AS the step, whatever the rounding', () => {
    expect(
      commit('5m', (h) => {
        h.required.set(true);
        h.rounding.set('floor');
      }),
    ).toBe(15 * 60);
  });
});

// =============================================================================
// emptyValue — what EMPTY is on the value channel (`null` by default)
// =============================================================================

@Component({
  imports: [AngularInlineDuration],
  template: `<angular-inline-duration [(value)]="value" [emptyValue]="emptyValue()" (saved)="sessions.push($event)" />`,
})
class EmptyValueHost {
  value = signal<number | null>(null);
  emptyValue = signal<number | null>(null);
  sessions: InlineDurationSaved[] = [];
}

describe('AngularInlineDuration — emptyValue', () => {
  function mount(init: (host: EmptyValueHost) => void) {
    const fixture = TestBed.createComponent(EmptyValueHost);
    init(fixture.componentInstance);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.inline-duration__input') as HTMLInputElement;
    const field = fixture.debugElement.query((el) => el.name === 'angular-inline-duration')!
      .componentInstance as AngularInlineDuration;
    return { fixture, input, field, host: fixture.componentInstance };
  }

  function commitEmpty(m: ReturnType<typeof mount>) {
    m.input.focus();
    m.fixture.detectChanges();
    m.input.value = '';
    m.input.dispatchEvent(new Event('input', { bubbles: true }));
    m.fixture.detectChanges();
    m.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    m.fixture.detectChanges();
  }

  it('by default EMPTY is null — and a real 0 is a value, not empty', () => {
    const m = mount((h) => h.value.set(0));
    expect(m.field.isEmpty()).toBe(false);
    expect(m.input.value).not.toBe('');

    commitEmpty(m);
    expect(m.host.value()).toBeNull();
  });

  it('[emptyValue]="0": 0 reads as empty (placeholder), and emptying writes 0', () => {
    const m = mount((h) => {
      h.emptyValue.set(0);
      h.value.set(0);
    });
    expect(m.field.isEmpty()).toBe(true);
    expect(m.input.value).toBe(''); // the placeholder shows, not "0:00"

    m.host.value.set(5400);
    m.fixture.detectChanges();
    commitEmpty(m);
    expect(m.host.value()).toBe(0);
    expect(m.host.sessions.at(-1)).toEqual({ value: 0, changed: true });
  });
});

// =============================================================================
// The error overlay — only while focused, only outside a hosting container
// that renders errors itself (`externalErrors`)
// =============================================================================

@Component({
  imports: [AngularInlineDuration, FormField],
  template: `<angular-inline-duration [formField]="field" />`,
})
class OverlayHost {
  model = signal<number | null>(null);
  field = form(this.model, (path) => required(path, { message: 'A value is required' }));
}

@Component({
  imports: [AngularInlineDuration, FormField],
  template: `<angular-inline-duration [formField]="field"><span editable-error class="custom-error">Custom message</span></angular-inline-duration>`,
})
class OverlaySlotHost {
  model = signal<number | null>(null);
  field = form(this.model, (path) => required(path, { message: 'A value is required' }));
}

describe('AngularInlineDuration — the error overlay', () => {
  const panel = () => document.querySelector('.inline-duration__panel') as HTMLElement | null;

  function mount<T>(type: new () => T & { field: () => { markAsTouched(): void } }) {
    const fixture = TestBed.createComponent(type);
    fixture.componentInstance.field().markAsTouched();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.inline-duration__input') as HTMLInputElement;
    return { fixture, input };
  }

  async function blurAway(fixture: ComponentFixture<unknown>) {
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('stays closed while idle — the error underline is the idle signal', () => {
    mount(OverlayHost);
    expect(panel()).toBeNull();
  });

  it('opens while focused and speaks the schema message by default', async () => {
    const { fixture, input } = mount(OverlayHost);
    input.focus();
    fixture.detectChanges();

    expect(panel()?.textContent).toContain('A value is required');
    await blurAway(fixture);
    expect(panel()).toBeNull();
  });

  it('the parse gate says why Enter was blocked', async () => {
    const { fixture, input } = mount(OverlayHost);
    input.focus();
    fixture.detectChanges();
    input.value = 'zz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(panel()?.textContent).toContain('Not a valid duration');
    await blurAway(fixture);
  });

  it('a projected [editable-error] takes the slot over the default messages', async () => {
    const { fixture, input } = mount(OverlaySlotHost);
    input.focus();
    fixture.detectChanges();

    expect(panel()?.querySelector('.custom-error')?.textContent).toBe('Custom message');
    expect(panel()?.textContent).not.toContain('A value is required');
    await blurAway(fixture);
  });
});

// =============================================================================
// Ruling 3 (2026-09-26): `format` in the house tokens; the placeholder is its shape
// =============================================================================

@Component({
  imports: [AngularInlineDuration],
  template: `<angular-inline-duration [(value)]="value" [format]="format()" />`,
})
class DurationFormatHost {
  value = signal<number | null>(null);
  format = signal<'HH:mm' | 'HH:mm:ss' | 'mm:ss'>('HH:mm');
}

describe('AngularInlineDuration — format', () => {
  it('shows the format as the placeholder and reads colon notation by it', () => {
    const fixture = TestBed.createComponent(DurationFormatHost);
    fixture.detectChanges();
    const input = () => fixture.nativeElement.querySelector('.inline-duration__input') as HTMLInputElement;

    expect(input().placeholder).toBe('HH:MM');

    fixture.componentInstance.format.set('mm:ss');
    fixture.componentInstance.value.set(90);
    fixture.detectChanges();
    expect(input().placeholder).toBe('MM:SS');
    expect(input().value).toBe('01:30');

    fixture.componentInstance.format.set('HH:mm:ss');
    fixture.detectChanges();
    expect(input().value).toBe('00:01:30');
  });
});
