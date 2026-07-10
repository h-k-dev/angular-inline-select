import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, min } from '@angular/forms/signals';

import {
  AngularInlineNumber,
  defaultParseNumber,
  defaultFormatNumber,
  type InlineNumberSaved,
} from './angular-inline-number';
import { AngularInlineText } from '../angular-inline-text/angular-inline-text';
import { EditableSuffix } from '../angular-inline-text/editable-affix';

// =============================================================================
// Hosts — one per binding mode
// =============================================================================

@Component({
  imports: [AngularInlineNumber],
  template: `
    <angular-inline-number
      [(value)]="value"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
      (touch)="touchCount = touchCount + 1"
    />
  `,
})
class NumberValueHost {
  value = signal<number | string | null>(42);

  saved: { value: number | null }[] = [];
  sessions: InlineNumberSaved[] = [];
  touchCount = 0;
}

@Component({
  imports: [AngularInlineNumber, FormField],
  template: `<angular-inline-number [formField]="field" />`,
})
class NumberFormHost {
  model = signal<number | null>(10);
  field = form(this.model, (path) => {
    min(path, 0);
  });
}

@Component({
  imports: [AngularInlineNumber, EditableSuffix],
  template: `
    <angular-inline-number [(value)]="value">
      <ng-template editableSuffix><span class="unit">€</span></ng-template>
    </angular-inline-number>
  `,
})
class NumberSuffixHost {
  value = signal<number | string | null>(49.9);
}

// =============================================================================
// Helpers
// =============================================================================

interface Harness<T> {
  fixture: ComponentFixture<T>;
  host: T;
  display: () => HTMLElement;
  editor: () => HTMLElement | null;
  inner: () => AngularInlineText;
}

function setup<T>(hostType: new () => T): Harness<T> {
  const fixture = TestBed.createComponent(hostType);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    display: () => fixture.nativeElement.querySelector('.editable-text__display') as HTMLElement,
    // The elevated editor renders in the CDK overlay container (document level)
    editor: () => document.querySelector('.editable-text__editor') as HTMLElement | null,
    inner: () =>
      fixture.debugElement.children[0].children[0].componentInstance as AngularInlineText,
  };
}

/** Simulates an edit session: elevate via an intercepted keystroke, replace the draft. */
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
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function accept(h: Harness<unknown>) {
  (h.inner() as unknown as { accept(): void }).accept();
  h.fixture.detectChanges();
}

// =============================================================================
// Specs
// =============================================================================

describe('number codec defaults', () => {
  it('parses dot decimals, empty to null, garbage to undefined', () => {
    expect(defaultParseNumber(' 12.5 ')).toBe(12.5);
    expect(defaultParseNumber('.5')).toBe(0.5);
    expect(defaultParseNumber('-3')).toBe(-3);
    expect(defaultParseNumber('')).toBeNull();
    expect(defaultParseNumber('  ')).toBeNull();
    expect(defaultParseNumber('12abc')).toBeUndefined();
  });

  it('rejects non-decimal shapes Number() would otherwise accept', () => {
    for (const bad of ['Infinity', '-Infinity', '1e3', '0x10', '0b101', '0o17', 'NaN', '1,000']) {
      expect(defaultParseNumber(bad)).toBeUndefined();
    }
  });

  it('formats null as empty', () => {
    expect(defaultFormatNumber(12.5)).toBe('12.5');
    expect(defaultFormatNumber(null)).toBe('');
  });
});

describe('AngularInlineNumber — [(value)] binding', () => {
  let h: Harness<NumberValueHost>;

  beforeEach(() => {
    h = setup(NumberValueHost);
  });

  it('renders the formatted committed value', () => {
    expect(h.display().textContent).toBe('42');
  });

  it('accepts a string-typed binding and renders it', () => {
    h.host.value.set('7.5');
    h.fixture.detectChanges();

    expect(h.display().textContent).toBe('7.5');
  });

  it('parses the live draft into the model as a number', async () => {
    await typeText(h, '55');

    expect(h.host.value()).toBe(55);
  });

  it('the parse gate blocks committing an unparseable draft', async () => {
    await typeText(h, '12abc');

    // Unparseable: the model holds the last good value
    expect(h.host.value()).toBe(42);

    accept(h);

    expect(h.inner().editing()).toBe(true);
    expect(h.host.saved).toEqual([]);
    expect(h.host.sessions).toEqual([]);
  });

  it('an empty draft commits null', async () => {
    await typeText(h, '');
    accept(h);

    expect(h.host.value()).toBeNull();
    expect(h.host.saved).toEqual([{ value: null }]);
    expect(h.host.sessions).toEqual([{ value: null, changed: true }]);
  });

  it('commits are numbers round-tripped through the codec', async () => {
    await typeText(h, ' 12.50 ');
    accept(h);

    expect(h.host.value()).toBe(12.5);
    expect(h.host.saved).toEqual([{ value: 12.5 }]);
    // The display shows the canonical formatting, not the raw draft
    expect(h.display().textContent).toBe('12.5');
  });

  it('discard settles once with changed=false and rolls the model back', async () => {
    await typeText(h, '99');
    expect(h.host.value()).toBe(99); // live channel

    (h.inner() as unknown as { cancel(): void }).cancel();
    h.fixture.detectChanges();

    expect(h.host.value()).toBe(42);
    expect(h.host.saved).toEqual([]);
    expect(h.host.sessions).toEqual([{ value: 42, changed: false }]);
  });
});

describe('AngularInlineNumber — affix forwarding', () => {
  it('forwards the suffix template through the composition into both render spots', async () => {
    const h = setup(NumberSuffixHost);

    const inFlow = h.fixture.nativeElement.querySelector(
      '.editable-text__field .editable-text__affix--suffix .unit',
    ) as HTMLElement | null;
    expect(inFlow?.textContent).toBe('€');

    await typeText(h, '55');

    const inPanel = document.querySelector(
      '.editable-panel__line .editable-text__affix--suffix .unit',
    );
    expect(inPanel?.textContent).toBe('€');

    // The affix never leaks into the draft or the committed number
    accept(h);
    expect(h.host.value()).toBe(55);
  });
});

describe('AngularInlineNumber — signal form [formField] binding', () => {
  let h: Harness<NumberFormHost>;

  beforeEach(() => {
    h = setup(NumberFormHost);
  });

  it('propagates parsed keystrokes live into the field', async () => {
    await typeText(h, '5');

    expect(h.host.field().value()).toBe(5);
  });

  it('schema errors block the commit (min violated)', async () => {
    await typeText(h, '-3');

    expect(h.host.field().value()).toBe(-3);
    expect(h.host.field().invalid()).toBe(true);

    accept(h);

    expect(h.inner().editing()).toBe(true);
    expect(h.host.model()).toBe(-3); // live channel — not committed, rolls back on discard
  });
});
