import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, required } from '@angular/forms/signals';

import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';

import { AngularInlineText } from 'angular-inline-select';

import { AngularInlinePhone, type InlinePhoneSaved } from './angular-inline-phone';
import { createLibphonenumberCodec } from './libphonenumber-codec';

const codec = createLibphonenumberCodec(metadata, examples);

// =============================================================================
// Hosts
// =============================================================================

@Component({
  imports: [AngularInlinePhone],
  template: `
    <angular-inline-phone
      [(value)]="value"
      [codec]="codec"
      defaultCountry="DE"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
      (touch)="touchCount = touchCount + 1"
    />
  `,
})
class PhoneValueHost {
  codec = codec;
  value = signal<string | null>('+491712345678');

  saved: { value: string | null }[] = [];
  sessions: InlinePhoneSaved[] = [];
  touchCount = 0;
}

@Component({
  imports: [AngularInlinePhone, FormField],
  template: `<angular-inline-phone [formField]="field" [codec]="codec" defaultCountry="DE" />`,
})
class PhoneFormHost {
  codec = codec;
  model = signal<string | null>(null);
  field = form(this.model, (path) => {
    required(path);
  });
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
  phone: () => AngularInlinePhone;
}

function setup<T>(hostType: new () => T): Harness<T> {
  const fixture = TestBed.createComponent(hostType);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    display: () => fixture.nativeElement.querySelector('.editable-text__display') as HTMLElement,
    editor: () => document.querySelector('.editable-text__editor') as HTMLElement | null,
    inner: () =>
      fixture.debugElement.children[0].children[0].componentInstance as AngularInlineText,
    phone: () => fixture.debugElement.children[0].componentInstance as AngularInlinePhone,
  };
}

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

  // Place the caret at the end, as real typing would — the slash-menu trigger
  // reads the caret position, so programmatic textContent alone isn't enough.
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

// =============================================================================
// Specs
// =============================================================================

describe('AngularInlinePhone — [(value)] binding', () => {
  let h: Harness<PhoneValueHost>;

  beforeEach(() => {
    h = setup(PhoneValueHost);
  });

  it('renders the committed value formatted (international by default)', () => {
    expect(h.display().textContent).toBe('+49 171 2345678');
  });

  it('shows the detected country flag as the prefix', () => {
    const prefix = h.fixture.nativeElement.querySelector(
      '.editable-text__affix--prefix',
    ) as HTMLElement | null;
    expect(prefix?.textContent?.trim()).toBe('🇩🇪');
  });

  it('the flag trigger is click-only — out of the tab order (slash menu is the keyboard path)', () => {
    const trigger = h.fixture.nativeElement.querySelector(
      '.country-trigger',
    ) as HTMLButtonElement | null;
    expect(trigger?.getAttribute('tabindex')).toBe('-1');
  });

  it('commits national input as E.164 through the codec round-trip', async () => {
    await typeText(h, '0170 9876543');
    accept(h);

    expect(h.host.value()).toBe('+491709876543');
    expect(h.host.saved).toEqual([{ value: '+491709876543' }]);
    expect(h.display().textContent).toBe('+49 170 9876543');
  });

  it('the parse gate blocks structurally unreadable drafts', async () => {
    await typeText(h, 'not a phone');
    accept(h);

    expect(h.inner().editing()).toBe(true);
    expect(h.host.saved).toEqual([]);
    expect(h.host.value()).toBe('+491712345678'); // last good value held
  });

  it('suspicious-but-readable drafts commit with a warning (warn, do not block)', async () => {
    await typeText(h, '017');

    expect(h.phone().parseWarning()).toBe('too-short');
    expect(h.phone().parseFailed()).toBe(false);

    accept(h);

    expect(h.inner().editing()).toBe(false);
    expect(h.host.saved).toEqual([{ value: '+49017' }]);
    expect(h.host.sessions).toEqual([{ value: '+49017', changed: true }]);
  });

  it('an empty draft commits null', async () => {
    await typeText(h, '');
    accept(h);

    expect(h.host.value()).toBeNull();
    expect(h.host.sessions).toEqual([{ value: null, changed: true }]);
  });

  it('typing / on the idle display elevates and opens the menu in one gesture', async () => {
    h.host.value.set(null);
    h.fixture.detectChanges();

    // A single `/` on the pristine display — should elevate AND open the menu,
    // not land in edit mode with a lone slash and no menu.
    const display = h.display();
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: '/' });
    display.dispatchEvent(event);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.inner().editing()).toBe(true);
    expect(h.editor()?.textContent).toBe('/');
    expect(document.querySelector('.editable-menu [role="option"]')).not.toBeNull();
  });

  it('the /country slash menu filters and inserts the dial code', async () => {
    // `/49` matches Germany's calling code — locale-independent, unlike names
    await typeText(h, '/49');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    const options = [...document.querySelectorAll('.editable-menu [role="option"]')];
    expect(options.length).toBeGreaterThan(0);
    const germany = options.find((option) => option.textContent?.includes('+49'));
    expect(germany).toBeTruthy();

    (germany as HTMLElement).click();
    h.fixture.detectChanges();

    // The draft becomes the dial-code prefix and the menu closes
    expect(h.editor()?.textContent).toBe('+49 ');
    expect(document.querySelector('.editable-menu')).toBeNull();
  });

  it('picking a country while idle swaps the dial code and preserves the national number', () => {
    // Committed as +49 30 49781234 (NSN 3049781234)
    h.host.value.set('+493049781234');
    h.fixture.detectChanges();

    // Pick Austria (+43) — the idle-commit path
    (
      h.phone() as unknown as { pickCountry(o: { country: string; dialCode: string }): void }
    ).pickCountry({
      country: 'AT',
      dialCode: '43',
    });
    h.fixture.detectChanges();

    // National number kept, calling code swapped, committed immediately
    expect(h.host.value()).toBe('+433049781234');
    expect(h.host.saved).toEqual([{ value: '+433049781234' }]);
    expect(h.host.sessions).toEqual([{ value: '+433049781234', changed: true }]);
  });

  it('the live preview interprets the draft without touching it', async () => {
    const hintText = () =>
      document.querySelector('.editable-panel__message--hint')?.textContent?.trim();

    // Unreadable: raw draft untouched, preview shows the … marker
    await typeText(h, 'abc');
    expect(h.editor()?.textContent).toBe('abc');
    expect(hintText()).toBe('… abc');

    // Readable but suspicious: ⚠ marker, still committable
    await typeText(h, '0171 23456789012345');
    expect(hintText()?.startsWith('⚠')).toBe(true);

    // Valid: ✓ + the international reading
    await typeText(h, '0171 2345678');
    expect(hintText()).toBe('✓ +49 171 2345678');
  });
});

describe('AngularInlinePhone — signal form [formField] binding', () => {
  let h: Harness<PhoneFormHost>;

  beforeEach(() => {
    h = setup(PhoneFormHost);
  });

  it('uses an example-number placeholder for the default country', () => {
    expect(h.display().getAttribute('data-placeholder')).toBe('01512 3456789');
  });

  it('propagates the parsed E.164 live into the field', async () => {
    await typeText(h, '0171 2345678');

    expect(h.host.field().value()).toBe('+491712345678');
  });
});
