import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, min } from '@angular/forms/signals';

import {
  AngularInlineNumber,
  defaultParseNumber,
  defaultFormatNumber,
  makeParseNumber,
  makeFormatNumber,
  type InlineNumberSaved,
} from './angular-inline-number';
import { AngularInlineText } from '../angular-inline-text/angular-inline-text';
import { EditableSuffix } from '../angular-inline-text/editable-affix';
import { EditableClear, EditableClearTemplate } from '../bubble-menu/editable-clear';

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

@Component({
  imports: [AngularInlineNumber],
  template: `
    <angular-inline-number
      [(value)]="value"
      [restrictInput]="restrict()"
      [decimalSeparator]="separator()"
    />
  `,
})
class NumberRestrictedHost {
  value = signal<number | string | null>(null);
  restrict = signal(true);
  separator = signal<'.' | ',' | 'both'>('both');
}

@Component({
  imports: [AngularInlineNumber],
  template: `
    <angular-inline-number
      [(value)]="value"
      [locale]="locale()"
      [numberFormatOptions]="options()"
      [restrictInput]="restrict()"
      decimalSeparator=","
    />
  `,
})
class NumberLocaleHost {
  value = signal<number | string | null>(1250000.5);
  locale = signal<string | undefined>('en');
  options = signal<{ minimumFractionDigits?: number; maximumFractionDigits?: number } | undefined>(
    undefined,
  );
  restrict = signal(false);
}

@Component({
  imports: [AngularInlineNumber, EditableClear, EditableClearTemplate],
  template: `
    <angular-inline-number [(value)]="value" (saved)="sessions.push($event)">
      <ng-template editableClear let-clear let-label="label">
        <button
          editableClear
          class="confirm-clear"
          [attr.aria-label]="label"
          (clear)="request(clear)"
        >
          ✕
        </button>
      </ng-template>
    </angular-inline-number>
  `,
})
class NumberClearHost {
  value = signal<number | string | null>(42);
  sessions: InlineNumberSaved[] = [];

  pending: (() => void) | null = null;

  request(clear: () => void) {
    this.pending = clear;
  }
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
  number: () => AngularInlineNumber;
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
    number: () => fixture.debugElement.children[0].componentInstance as AngularInlineNumber,
  };
}

/**
 * Simulates an edit session: elevate via an intercepted keystroke, replace
 * the draft. `seed` is the elevating character — pass one the field admits
 * when `restrictInput` is on.
 */
async function typeText(h: Harness<unknown>, text: string, seed = 'x') {
  const display = h.display();

  const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
  Object.defineProperty(event, 'inputType', { value: 'insertText' });
  Object.defineProperty(event, 'data', { value: seed });

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

// =============================================================================
// Decimal separator + restricted input
// =============================================================================

describe('separator-aware codec', () => {
  it('accepts either separator on "both" and normalizes to a dot-decimal number', () => {
    const parse = makeParseNumber('both');

    expect(parse('1,5')).toBe(1.5);
    expect(parse('1.5')).toBe(1.5);
    expect(parse(',5')).toBe(0.5);
    expect(parse('-2,25')).toBe(-2.25);
  });

  it('accepts only the configured separator', () => {
    expect(makeParseNumber(',')('1,5')).toBe(1.5);
    expect(makeParseNumber(',')('1.5')).toBeUndefined();
    expect(makeParseNumber('.')('1,5')).toBeUndefined();
    expect(makeParseNumber('.')('1.5')).toBe(1.5);
  });

  it('still rejects the shapes Number() would otherwise accept', () => {
    const parse = makeParseNumber('both');

    for (const bad of ['Infinity', '1e3', '0x10', 'NaN', '1.2.3', '1,2,3', '--5']) {
      expect(parse(bad)).toBeUndefined();
    }
  });

  it('reads a comma as a DECIMAL point, so "1,000" is one — not one thousand', () => {
    // Documented consequence: a field cannot take the comma in both roles.
    expect(makeParseNumber('both')('1,000')).toBe(1);
    expect(defaultParseNumber('1,000')).toBeUndefined();
  });

  it('formats with the configured separator, "both" settling on the dot', () => {
    expect(makeFormatNumber(',')(1.5)).toBe('1,5');
    expect(makeFormatNumber('both')(1.5)).toBe('1.5');
    expect(makeFormatNumber('.')(1.5)).toBe('1.5');
    expect(makeFormatNumber(',')(null)).toBe('');
  });

  it('keeps the dot-decimal defaults unchanged', () => {
    expect(defaultParseNumber('12.5')).toBe(12.5);
    expect(defaultFormatNumber(12.5)).toBe('12.5');
  });
});

describe('AngularInlineNumber — decimalSeparator on the composed control', () => {
  let h: Harness<NumberRestrictedHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NumberRestrictedHost] });
    h = setup(NumberRestrictedHost);
  });

  it("renders idle text with the ',' separator, not just in the formatter unit", () => {
    h.host.separator.set(',');
    h.host.value.set(48.5);
    h.fixture.detectChanges();

    expect(h.display().textContent).toBe('48,5');
  });

  it("settles 'both' on the canonical dot", () => {
    h.host.separator.set('both');
    h.host.value.set(48.5);
    h.fixture.detectChanges();

    expect(h.display().textContent).toBe('48.5');
  });

  it('keeps the model dot-decimal whatever the display shows', () => {
    h.host.separator.set(',');
    h.host.value.set(48.5);
    h.fixture.detectChanges();

    // A separator never crosses the contract boundary.
    expect(h.host.value()).toBe(48.5);
    expect(h.number().parseFailed()).toBe(false);
  });
});

describe('AngularInlineNumber — restrictInput', () => {
  let h: Harness<NumberRestrictedHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NumberRestrictedHost] });
    h = setup(NumberRestrictedHost);
  });

  /** Opens the session with an accepted character, then replaces the draft. */
  async function typeRestricted(text: string) {
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: '0' });

    h.display().dispatchEvent(event);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    const editor = h.editor();
    if (!editor) throw new Error('elevated editor not found');

    editor.textContent = text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    h.fixture.detectChanges();
  }

  it('rejects letters as they are typed and never raises the parse gate', async () => {
    await typeRestricted('12ab,5');

    expect(h.editor()?.textContent).toBe('12,5');
    expect(h.inner().value()).toBe('12,5');
    // The letters never landed, so the draft was never unparseable.
    expect(h.number().parseFailed()).toBe(false);
  });

  it('normalizes a comma draft to a dot-decimal number on the model', async () => {
    await typeRestricted('12,5');
    accept(h);

    expect(h.host.value()).toBe(12.5);
  });

  it('admits BOTH separators regardless of the codec — no dead decimal key', async () => {
    // The filter is a superset of every codec, never a mirror of one: a
    // ','-codec field on a '.'-emitting keyboard must not silently swallow
    // the decimal key. The codec stays the authority on what parses.
    h.host.separator.set(',');
    h.fixture.detectChanges();

    await typeRestricted('1.5');

    expect(h.inner().value()).toBe('1.5');
    // Admitted by the filter, rejected by the codec — visibly, via the gate.
    expect(h.number().parseFailed()).toBe(true);
  });

  it('parses the codec-correct separator through the same filter', async () => {
    h.host.separator.set(',');
    h.fixture.detectChanges();

    await typeRestricted('1,5');
    accept(h);

    expect(h.host.value()).toBe(1.5);
  });

  it('lets everything through when the opt-in is off', async () => {
    h.host.restrict.set(false);
    h.fixture.detectChanges();

    await typeRestricted('12ab');

    expect(h.inner().value()).toBe('12ab');
    expect(h.number().parseFailed()).toBe(true);
  });

  it('filters, it does not validate — the parse gate still catches "1.2.3"', async () => {
    h.host.separator.set('.');
    h.fixture.detectChanges();

    await typeRestricted('1.2.3');

    expect(h.inner().value()).toBe('1.2.3');
    expect(h.number().parseFailed()).toBe(true);
  });
});

describe('AngularInlineNumber — clear affordance', () => {
  it("forwards the consumer's clear template into the inner control's bubble", () => {
    const h = setup(NumberClearHost);

    // Content queries don't pierce re-projection — the wrapper re-declares the
    // slot and forwards a TemplateRef, exactly like the affixes.
    h.display().closest('.editable-text__field')!.dispatchEvent(new MouseEvent('mouseenter'));
    h.fixture.detectChanges();

    const custom = document.querySelector<HTMLButtonElement>(
      '.editable-bubble button.confirm-clear',
    );
    expect(custom).not.toBeNull();
    expect(custom!.getAttribute('aria-label')).toBe('Clear value');
    expect(document.querySelector('.editable-bubble button.editable-action-clear')).toBeNull();

    custom!.dispatchEvent(new MouseEvent('click'));
    h.fixture.detectChanges();
    expect(h.host.value()).toBe(42);

    // The confirmed clear settles through the wrapper as a NUMBER contract
    // commit: null, never the inner control's empty string.
    h.host.pending!();
    h.fixture.detectChanges();

    expect(h.host.value()).toBeNull();
    expect(h.host.sessions).toEqual([{ value: null, changed: true }]);
  });
});

describe('AngularInlineNumber — locale codec', () => {
  let h: Harness<NumberLocaleHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NumberLocaleHost] });
    h = setup(NumberLocaleHost);
  });

  it('renders the idle text grouped the way the locale writes it', () => {
    expect(h.display().textContent).toBe('1,250,000.5');

    h.host.locale.set('de');
    h.fixture.detectChanges();
    expect(h.display().textContent).toBe('1.250.000,5');
  });

  it('supersedes decimalSeparator while set, and hands back when unset', () => {
    h.host.locale.set(undefined);
    h.fixture.detectChanges();

    // The host's decimalSeparator="," takes over again: no grouping, comma decimal.
    expect(h.display().textContent).toBe('1250000,5');
  });

  it('applies Intl options — fixed decimals for money', () => {
    h.host.options.set({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
    h.fixture.detectChanges();
    expect(h.display().textContent).toBe('1,250,000.50');
  });

  it('reads a grouped OR plain draft under the locale and commits a dot-decimal number', async () => {
    h.host.locale.set('de');
    h.fixture.detectChanges();

    await typeText(h, '2.500,75');
    expect(h.number().parseFailed()).toBe(false);
    accept(h);
    expect(h.host.value()).toBe(2500.75);
    expect(h.display().textContent).toBe('2.500,75');

    await typeText(h, '3000,5');
    accept(h);
    expect(h.host.value()).toBe(3000.5);
    // The commit round-trips the codec: typed plain, displayed grouped.
    expect(h.display().textContent).toBe('3.000,5');
  });

  it('raises the parse gate on the wrong mark instead of reading it as a group', async () => {
    h.host.locale.set('de');
    h.fixture.detectChanges();

    await typeText(h, '1.5');
    expect(h.number().parseFailed()).toBe(true);
    // The model holds the last good value.
    expect(h.host.value()).toBe(1250000.5);
  });

  it('the editor opens on the PLAIN number — no groups, no padded decimals', async () => {
    h.host.locale.set('de');
    h.host.options.set({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
    h.fixture.detectChanges();
    expect(h.display().textContent).toBe('1.250.000,50');

    // Elevate with a real keystroke (no draft replacement): the editor holds
    // the plain rendering plus the typed digit, the display keeps the groups.
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: '0' });
    h.display().dispatchEvent(event);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.editor()?.textContent).toBe('1250000,50');
    expect(h.display().textContent).toBe('1.250.000,50');
    expect(h.number().parseFailed()).toBe(false);

    accept(h);
    expect(h.host.value()).toBe(1250000.5);
    expect(h.display().textContent).toBe('1.250.000,50');
  });

  it('a display that never rounds cannot rewrite the model on save', async () => {
    h.host.value.set(1.23456);
    h.fixture.detectChanges();
    expect(h.display().textContent).toBe('1.23456');

    await typeText(h, '1.23456');
    accept(h);
    expect(h.host.value()).toBe(1.23456);
  });

  it("restrictInput widens by the locale's own separators", async () => {
    h.host.locale.set('fr');
    h.host.restrict.set(true);
    h.fixture.detectChanges();

    // fr groups with a (narrow no-break) space — the plain space must survive
    // the filter so the grouped display pastes back into its own field.
    await typeText(h, '1 000,5x', '1');
    expect(h.inner().value()).toBe('1 000,5');
    expect(h.number().parseFailed()).toBe(false);
    accept(h);
    expect(h.host.value()).toBe(1000.5);
  });
});
