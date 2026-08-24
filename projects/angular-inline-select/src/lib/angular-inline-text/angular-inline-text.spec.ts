import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, type ValidationError } from '@angular/forms/signals';

import {
  AngularInlineText,
  normalizeString,
  type InlineTextSaved,
  type InlineTextWrapBehavior,
} from './angular-inline-text';
import { EditableSuffix } from './editable-affix';
import { detectSlashToken } from './editable-menu';
import { replayEdit, filterChars, getSelectionOffsets, setCaretOffset } from './caret';

// =============================================================================
// Hosts — one per binding mode
// =============================================================================

@Component({
  imports: [AngularInlineText],
  template: `
    <angular-inline-text
      [(value)]="value"
      [normalizeValue]="true"
      [errors]="errors()"
      [touched]="touched()"
      [disabled]="disabled()"
      (savedModelChange)="saved.push($event)"
      (reverted)="revertedDrafts.push($event)"
      (saved)="sessions.push($event)"
      (touch)="touchCount = touchCount + 1"
    />
  `,
})
class ValueBindingHost {
  value = signal('initial');
  errors = signal<readonly ValidationError.WithOptionalFieldTree[]>([]);
  touched = signal(false);
  disabled = signal(false);

  saved: { value: string }[] = [];
  revertedDrafts: string[] = [];
  sessions: InlineTextSaved[] = [];
  touchCount = 0;
}

@Component({
  imports: [AngularInlineText, FormField],
  template: `<angular-inline-text [formField]="field" />`,
})
class SignalFormHost {
  model = signal('initial');
  field = form(this.model);
}

@Component({
  imports: [AngularInlineText],
  template: `
    <angular-inline-text [(value)]="value" [errors]="errors()">
      <span editable-error>Custom pattern message</span>
    </angular-inline-text>
  `,
})
class ProjectedErrorHost {
  value = signal('initial');
  errors = signal<readonly ValidationError.WithOptionalFieldTree[]>([]);
}

@Component({
  imports: [AngularInlineText],
  template: `
    <angular-inline-text
      [(value)]="value"
      [isSingleLine]="isSingleLine()"
      [wrapBehavior]="wrapBehavior()"
    />
  `,
})
class WrapHost {
  value = signal('a value long enough to need a decision about wrapping');
  isSingleLine = signal(false);
  wrapBehavior = signal<InlineTextWrapBehavior>('noWrap');
}

@Component({
  imports: [AngularInlineText, EditableSuffix],
  template: `
    <angular-inline-text [(value)]="value" [isSingleLine]="true">
      <ng-template editableSuffix><span class="unit">kg</span></ng-template>
    </angular-inline-text>
  `,
})
class SuffixHost {
  value = signal('10');
}

@Component({
  imports: [AngularInlineText],
  template: `
    <angular-inline-text [(value)]="value" [isSingleLine]="true" [allowedChars]="allowed()" />
  `,
})
class FilteredHost {
  value = signal('');
  allowed = signal<RegExp | undefined>(/[0-9]/);
}

// =============================================================================
// Helpers
// =============================================================================

interface Harness<T> {
  fixture: ComponentFixture<T>;
  host: T;
  editable: () => AngularInlineText;
  display: () => HTMLElement;
  editor: () => HTMLElement | null;
}

function setup<T>(hostType: new () => T): Harness<T> {
  const fixture = TestBed.createComponent(hostType);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    editable: () => fixture.debugElement.children[0].componentInstance as AngularInlineText,
    display: () => fixture.nativeElement.querySelector('.editable-text__display') as HTMLElement,
    // The elevated editor renders in the CDK overlay container (document level)
    editor: () => document.querySelector('.editable-text__editor') as HTMLElement | null,
  };
}

/** Dispatches an intercepted first edit on the display element to elevate the field. */
async function elevate(h: Harness<unknown>) {
  const display = h.display();

  const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
  Object.defineProperty(event, 'inputType', { value: 'insertText' });
  Object.defineProperty(event, 'data', { value: 'x' });

  display.dispatchEvent(event);
  h.fixture.detectChanges();

  // The editor is seeded + focused in a microtask after overlay attach.
  await h.fixture.whenStable();
  h.fixture.detectChanges();
}

/** Simulates an edit session: elevate, replace the draft, dispatch input. */
async function typeText(h: Harness<unknown>, text: string) {
  await elevate(h);

  const editor = h.editor();
  if (!editor) throw new Error('elevated editor not found');

  editor.textContent = text;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function accept(h: Harness<unknown>) {
  (h.editable() as unknown as { accept(): void }).accept();
  h.fixture.detectChanges();
}

function cancel(h: Harness<unknown>) {
  (h.editable() as unknown as { cancel(): void }).cancel();
  h.fixture.detectChanges();
}

// =============================================================================
// Specs
// =============================================================================

describe('normalizeString', () => {
  it('trims edge whitespace and preserves interior spacing and line breaks', () => {
    expect(normalizeString('  hello \n  world  ')).toBe('hello \n  world');
  });
});

describe('detectSlashToken', () => {
  it('detects a slash token at the start of the draft', () => {
    expect(detectSlashToken('/ger', 4)).toEqual({ start: 0, end: 4, query: 'ger' });
  });

  it('detects a slash token after whitespace', () => {
    expect(detectSlashToken('call /de', 8)).toEqual({ start: 5, end: 8, query: 'de' });
  });

  it('ignores a mid-word slash (either/or, URLs)', () => {
    expect(detectSlashToken('either/or', 9)).toBeNull();
    expect(detectSlashToken('http://x', 8)).toBeNull();
  });

  it('closes once whitespace follows the slash', () => {
    expect(detectSlashToken('/de now', 7)).toBeNull();
  });

  it('reads the query only up to the caret', () => {
    expect(detectSlashToken('/german', 4)).toEqual({ start: 0, end: 4, query: 'ger' });
  });

  it('a bare slash is an open token with an empty query', () => {
    expect(detectSlashToken('/', 1)).toEqual({ start: 0, end: 1, query: '' });
  });
});

describe('replayEdit', () => {
  const sel = (start: number, end = start) => ({ start, end });

  it('inserts typed text at the caret', () => {
    expect(replayEdit('hello', sel(5), { inputType: 'insertText', data: '!' }, false)).toEqual({
      text: 'hello!',
      caret: 6,
    });
  });

  it('replaces a selection with typed text', () => {
    expect(replayEdit('hello', sel(0, 5), { inputType: 'insertText', data: 'y' }, false)).toEqual({
      text: 'y',
      caret: 1,
    });
  });

  it('backspace deletes the character before the caret', () => {
    expect(
      replayEdit('hello', sel(5), { inputType: 'deleteContentBackward', data: null }, false),
    ).toEqual({ text: 'hell', caret: 4 });
  });

  it('backspace at offset 0 is a no-op', () => {
    expect(
      replayEdit('hello', sel(0), { inputType: 'deleteContentBackward', data: null }, false),
    ).toBeNull();
  });

  it('delete-forward removes the character after the caret', () => {
    expect(
      replayEdit('hello', sel(0), { inputType: 'deleteContentForward', data: null }, false),
    ).toEqual({ text: 'ello', caret: 0 });
  });

  it('line breaks insert newlines in multiline mode only', () => {
    expect(replayEdit('ab', sel(1), { inputType: 'insertParagraph', data: null }, false)).toEqual({
      text: 'a\nb',
      caret: 2,
    });
    expect(replayEdit('ab', sel(1), { inputType: 'insertParagraph', data: null }, true)).toBeNull();
  });

  it('unknown input types are not replayed', () => {
    expect(replayEdit('ab', sel(1), { inputType: 'insertFromDrop', data: 'x' }, false)).toBeNull();
  });
});

describe('AngularInlineText — standalone', () => {
  it('should create', () => {
    const fixture = TestBed.createComponent(AngularInlineText);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });
});

describe('AngularInlineText — [(value)] binding', () => {
  let h: Harness<ValueBindingHost>;

  beforeEach(() => {
    h = setup(ValueBindingHost);
  });

  it('renders the committed value in the display element', () => {
    expect(h.display().textContent).toBe('initial');
  });

  it('typing on the pristine display never mutates it — the field elevates instead', async () => {
    await elevate(h);

    expect(h.display().textContent).toBe('initial');
    expect(h.editable().editing()).toBe(true);
    expect(h.editor()).not.toBeNull();
  });

  it('the first intercepted keystroke is replayed into the draft and the live channel', async () => {
    await elevate(h); // simulated insertText 'x' at the end

    // Live draft channel: bound parents follow the seed immediately, while
    // the session baseline stays pinned at the committed value.
    expect(h.host.value()).toBe('initialx');
    expect(h.editable().previous()).toBe('initial');
  });

  it('propagates keystrokes live while the display stays frozen at the baseline', async () => {
    await typeText(h, 'draft text');

    expect(h.host.value()).toBe('draft text');
    expect(h.host.saved).toEqual([]);
    // Frozen display: the page never sees the draft
    expect(h.display().textContent).toBe('initial');
  });

  it('accept commits the normalized value and emits savedModelChange once', async () => {
    await typeText(h, '  new   value \n here ');
    accept(h);

    // Edges trimmed, interior spacing and line breaks preserved
    expect(h.host.value()).toBe('new   value \n here');
    expect(h.host.saved).toEqual([{ value: 'new   value \n here' }]);
    expect(h.editable().editing()).toBe(false);
  });

  it('accept without changes closes and emits nothing', async () => {
    await typeText(h, 'initial');
    accept(h);

    expect(h.host.saved).toEqual([]);
    expect(h.host.value()).toBe('initial');
    expect(h.editable().editing()).toBe(false);
  });

  it('cancel restores the baseline and emits the discarded draft', async () => {
    await typeText(h, 'abandoned draft');
    cancel(h);

    expect(h.host.value()).toBe('initial');
    expect(h.host.revertedDrafts).toEqual(['abandoned draft']);
    expect(h.host.saved).toEqual([]);
    expect(h.editable().editing()).toBe(false);
  });

  it('cancel without changes does not emit reverted', async () => {
    await typeText(h, 'initial');
    cancel(h);

    expect(h.host.revertedDrafts).toEqual([]);
  });

  it('saved settles a committed session exactly once with changed=true', async () => {
    await typeText(h, '  new   value ');
    accept(h);

    expect(h.host.sessions).toEqual([{ value: 'new   value', changed: true }]);
  });

  it('saved settles a discarded session exactly once with changed=false', async () => {
    await typeText(h, 'abandoned draft');
    cancel(h);

    expect(h.host.sessions).toEqual([{ value: 'initial', changed: false }]);
  });

  it('saved settles a no-diff accept exactly once with changed=false', async () => {
    await typeText(h, 'initial');
    accept(h);

    expect(h.host.sessions).toEqual([{ value: 'initial', changed: false }]);
  });

  it('the bound touched status reveals the idle error state without interaction', () => {
    h.host.errors.set([{ kind: 'pattern' }]);
    h.fixture.detectChanges();

    const host = h.fixture.nativeElement.querySelector('angular-inline-text') as HTMLElement;
    const display = h.display();

    // Invalid but untouched: no idle error, no aria-invalid
    expect(host.classList.contains('editable-text--invalid')).toBe(false);
    expect(display.getAttribute('aria-invalid')).toBeNull();

    h.host.touched.set(true);
    h.fixture.detectChanges();

    expect(host.classList.contains('editable-text--invalid')).toBe(true);
    expect(display.getAttribute('aria-invalid')).toBe('true');
  });

  it('reset() discards an open draft back to the baseline with no emissions', async () => {
    await typeText(h, 'draft in flight');

    h.editable().reset();
    h.fixture.detectChanges();

    expect(h.editable().editing()).toBe(false);
    expect(h.host.value()).toBe('initial');

    // A programmatic reset is not a user interaction
    expect(h.host.touchCount).toBe(0);
    expect(h.host.sessions).toEqual([]);
    expect(h.host.revertedDrafts).toEqual([]);
  });

  it('clear commits an empty value and marks the field touched', () => {
    (h.editable() as unknown as { clearValue(event: Event): void }).clearValue(new Event('click'));
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('');
    expect(h.host.saved).toEqual([{ value: '' }]);
    expect(h.host.sessions).toEqual([{ value: '', changed: true }]);
    expect(h.host.touchCount).toBe(1);
  });

  it('errors block accept and the failed attempt reveals them (mat submit semantics)', async () => {
    h.host.errors.set([{ kind: 'server', message: 'Taken' }]);
    h.fixture.detectChanges();

    await typeText(h, 'invalid attempt');

    // Pristine error state: invalid but not yet revealed
    expect(document.querySelector('.editable-panel__message--error')).toBeNull();

    accept(h);

    expect(h.host.saved).toEqual([]);
    expect(h.editable().editing()).toBe(true);
    // The attempt marks the field touched and reveals the message
    expect(h.host.touchCount).toBe(1);
    expect(document.querySelector('.editable-panel__message--error')?.textContent?.trim()).toBe(
      'Taken',
    );
  });

  it('emits touch when the edit session closes', () => {
    const editable = h.editable();

    editable.editing.set(true);
    h.fixture.detectChanges();
    editable.editing.set(false);
    h.fixture.detectChanges();

    expect(h.host.touchCount).toBe(1);
  });

  it('cut on the idle display elevates with the selection removed and writes the clipboard', () => {
    const display = h.display();

    // Select the whole committed value on the pristine display
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(display);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let clipped: string | null = null;
    const event = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_type: string, value: string) => (clipped = value) },
    });
    display.dispatchEvent(event);
    h.fixture.detectChanges();

    // One gesture: clipboard has the text, the field is elevated and emptied
    expect(clipped).toBe('initial');
    expect(h.editable().editing()).toBe(true);
    expect(h.host.value()).toBe('');
  });

  it('disabled renders a non-editable display and does not elevate', async () => {
    h.host.disabled.set(true);
    h.fixture.detectChanges();

    expect(h.display().getAttribute('contenteditable')).toBe('false');

    await elevate(h);
    expect(h.editable().editing()).toBe(false);
  });
});

describe('AngularInlineText — signal form [formField] binding', () => {
  let h: Harness<SignalFormHost>;

  beforeEach(() => {
    h = setup(SignalFormHost);
  });

  it('propagates keystrokes live into the field so schema validation can run', async () => {
    await typeText(h, 'typed');
    expect(h.host.field().value()).toBe('typed');
  });

  it('accept commits into the field', async () => {
    await typeText(h, 'committed');
    accept(h);

    expect(h.host.field().value()).toBe('committed');
    expect(h.host.model()).toBe('committed');
  });

  it('cancel leaves the field at the session baseline', async () => {
    await typeText(h, 'draft');
    cancel(h);

    expect(h.host.field().value()).toBe('initial');
  });

  it('marks the field touched when the session closes', () => {
    expect(h.host.field().touched()).toBe(false);

    const editable = h.editable();
    editable.editing.set(true);
    h.fixture.detectChanges();
    editable.editing.set(false);
    h.fixture.detectChanges();

    expect(h.host.field().touched()).toBe(true);
  });
});

describe('AngularInlineText — affix templates', () => {
  let h: Harness<SuffixHost>;

  beforeEach(() => {
    h = setup(SuffixHost);
  });

  it('renders the suffix in the in-flow field and again inside the panel', async () => {
    const inFlow = h.fixture.nativeElement.querySelector(
      '.editable-text__field .editable-text__affix--suffix .unit',
    ) as HTMLElement | null;
    expect(inFlow?.textContent).toBe('kg');

    await elevate(h);

    // Second instance beside the editor (in the overlay), outside the contenteditable
    const inPanel = document.querySelector('.editable-panel__line .editable-text__affix--suffix .unit');
    expect(inPanel?.textContent).toBe('kg');
    expect(h.editor()?.contains(inPanel!)).toBe(false);
  });

  it('the affix is decorative: aria-hidden and not in the committed value', async () => {
    const affix = h.fixture.nativeElement.querySelector('.editable-text__affix--suffix') as HTMLElement;
    expect(affix.getAttribute('aria-hidden')).toBe('true');

    await typeText(h, '25');
    (h.editable() as unknown as { accept(): void }).accept();
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('25');
  });
});

describe('AngularInlineText — projected [editable-error]', () => {
  let h: Harness<ProjectedErrorHost>;

  beforeEach(() => {
    h = setup(ProjectedErrorHost);
  });

  it('is gated by the field itself and takes over the slot from the built-in messages', async () => {
    h.host.errors.set([{ kind: 'pattern', message: 'Built-in message' }]);
    h.fixture.detectChanges();

    await typeText(h, 'invalid attempt');

    // Pristine error state: the whole slot stays hidden, projection included
    expect(document.querySelector('[editable-error]')).toBeNull();

    accept(h);

    // The failed attempt reveals the slot: projected content only — the
    // built-in message rendering is taken over entirely
    expect(document.querySelector('[editable-error]')?.textContent?.trim()).toBe(
      'Custom pattern message',
    );
    expect(document.querySelector('.editable-panel__message--error')).toBeNull();
  });
});

// `isSingleLine` owns the VALUE (may a line break exist?), `wrapBehavior` owns
// the PAINT (what happens at a width constraint) — all four combinations are
// legal, and neither input may reach into the other's concern.
describe('AngularInlineText — isSingleLine vs wrapBehavior', () => {
  let h: Harness<WrapHost>;

  const paintsNoWrap = () => h.display().classList.contains('editable-text__display--no-wrap');

  const set = (isSingleLine: boolean, wrapBehavior: InlineTextWrapBehavior = 'noWrap') => {
    h.host.isSingleLine.set(isSingleLine);
    h.host.wrapBehavior.set(wrapBehavior);
    h.fixture.detectChanges();
  };

  beforeEach(() => {
    h = setup(WrapHost);
  });

  it('single-line: noWrap by default, wrap on request', () => {
    set(true);
    expect(paintsNoWrap()).toBe(true);

    // A single-line value wrapped over several visual lines
    set(true, 'wrap');
    expect(paintsNoWrap()).toBe(false);
  });

  it('multi-line always wraps — wrapBehavior is inert outside single-line', () => {
    set(false, 'noWrap');
    expect(paintsNoWrap()).toBe(false);

    set(false, 'wrap');
    expect(paintsNoWrap()).toBe(false);
  });

  it('single-line still forbids line breaks in the value while wrapping', async () => {
    set(true, 'wrap');

    await typeText(h, 'first\nsecond');
    accept(h);

    expect(h.host.value()).toBe('first second');
  });

  it('multi-line keeps line breaks in the value, whatever wrapBehavior says', async () => {
    set(false, 'noWrap');

    await typeText(h, 'first\nsecond');
    accept(h);

    expect(h.host.value()).toBe('first\nsecond');
  });

  it('single-line still accepts on Enter while wrapping', async () => {
    set(true, 'wrap');

    await typeText(h, 'typed');
    h.editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('typed');
    expect(h.editable().editing()).toBe(false);
  });

  it('the elevated editor always wraps — it never carries the no-wrap paint', async () => {
    set(true, 'noWrap');

    await elevate(h);

    expect(h.editor()!.classList.contains('editable-text__display--no-wrap')).toBe(false);
  });
});


// =============================================================================
// Character filtering
// =============================================================================

describe('filterChars', () => {
  it('drops rejected characters and keeps the caret on the survivors', () => {
    // "1aa2" with the caret at the end → "12", caret follows to 2.
    expect(filterChars('1aa2', 4, /[0-9]/)).toEqual({ text: '12', caret: 2 });
  });

  it('shifts the caret only by rejections that fall BEFORE it', () => {
    // "1a2b", caret between "a" and "2" (offset 2): one rejection precedes it.
    expect(filterChars('1a2b', 2, /[0-9]/)).toEqual({ text: '12', caret: 1 });
  });

  it('leaves accepted text and the caret untouched', () => {
    expect(filterChars('123', 2, /[0-9]/)).toEqual({ text: '123', caret: 2 });
  });

  it('can empty the text entirely', () => {
    expect(filterChars('abc', 3, /[0-9]/)).toEqual({ text: '', caret: 0 });
  });

  it('normalizes stateful flags itself — a /g caller must not get every other char', () => {
    // Defended in the helper, not just in the component: `caret.ts` is public
    // API, so a direct consumer can pass /g. Undefended this returns '13'.
    expect(filterChars('1234', 4, /[0-9]/g)).toEqual({ text: '1234', caret: 4 });
    expect(filterChars('1234', 4, /[0-9]/y)).toEqual({ text: '1234', caret: 4 });
  });
});

describe('AngularInlineText — allowedChars', () => {
  let h: Harness<FilteredHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FilteredHost] });
    h = setup(FilteredHost);
  });

  /**
   * The shared `elevate()` helper types 'x', which a digit filter rejects —
   * and a rejected keystroke deliberately does NOT elevate. Open the session
   * with an accepted character instead, then replace the draft.
   */
  async function typeFiltered(text: string) {
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

  it('never writes a rejected character to the value channel', async () => {
    await typeFiltered('1aa2');

    expect(h.host.value()).toBe('12');
    expect(h.editor()?.textContent).toBe('12');
  });

  it('passes the draft through untouched when no filter is set', async () => {
    h.host.allowed.set(undefined);
    h.fixture.detectChanges();

    await elevate(h);
    await typeText(h, '1aa2');

    expect(h.host.value()).toBe('1aa2');
  });

  it('strips stateful regex flags — a /g filter would reject every other char', async () => {
    h.host.allowed.set(/[0-9]/g);
    h.fixture.detectChanges();

    await typeFiltered('1234');

    expect(h.host.value()).toBe('1234');
  });

  // ---------------------------------------------------------------------------
  // The swallow guard: only a mutation elevates
  // ---------------------------------------------------------------------------

  it('does NOT elevate when the filter erases the whole keystroke', () => {
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: 'a' });

    h.display().dispatchEvent(event);
    h.fixture.detectChanges();

    expect(h.editable().editing()).toBe(false);
    expect(h.host.value()).toBe('');
  });

  it('DOES elevate when a rejected keystroke replaces a selection', async () => {
    // Baseline "42", the whole of it selected, then "a" typed: the letter is
    // rejected but the selection was still removed — that is a real mutation.
    h.host.value.set('42');
    h.fixture.detectChanges();

    const display = h.display();
    const range = document.createRange();
    range.selectNodeContents(display);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: 'a' });

    display.dispatchEvent(event);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.editable().editing()).toBe(true);
    expect(h.host.value()).toBe('');
  });

  it('elevates on an accepted keystroke', async () => {
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: '7' });

    h.display().dispatchEvent(event);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.editable().editing()).toBe(true);
    expect(h.host.value()).toBe('7');
  });
});


// =============================================================================
// Filtering: per-keystroke path, caret, IME, paste
// =============================================================================

describe('AngularInlineText — allowedChars, keystroke by keystroke', () => {
  let h: Harness<FilteredHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FilteredHost] });
    h = setup(FilteredHost);
  });

  /** Opens the session on an accepted character. */
  async function open() {
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: '0' });

    h.display().dispatchEvent(event);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
  }

  /**
   * Types into the editor ONE character at a time, inserting at the live
   * caret the way a keyboard does — rather than replacing the whole draft and
   * filtering once. This is the path that actually exercises the rewrite and
   * the caret restore.
   */
  function typeEach(chars: string) {
    const editor = h.editor();
    if (!editor) throw new Error('elevated editor not found');

    for (const ch of chars) {
      const at = getSelectionOffsets(editor)?.start ?? (editor.textContent ?? '').length;
      const text = editor.textContent ?? '';

      editor.textContent = text.slice(0, at) + ch + text.slice(at);
      setCaretOffset(editor, at + 1);

      editor.dispatchEvent(new Event('input', { bubbles: true }));
      h.fixture.detectChanges();
    }
  }

  function caretAt(el: HTMLElement) {
    return getSelectionOffsets(el)?.start ?? -1;
  }

  it('filters each keystroke as it lands, never accumulating rejects', async () => {
    await open();

    const editor = h.editor()!;
    editor.textContent = '';
    setCaretOffset(editor, 0);

    typeEach('1aa2');

    expect(editor.textContent).toBe('12');
    expect(h.host.value()).toBe('12');
  });

  it('holds the caret in place across a filtered rewrite', async () => {
    await open();

    const editor = h.editor()!;
    editor.textContent = '15';
    setCaretOffset(editor, 1);

    // A rejected keystroke mid-text must not drift the caret to the end.
    typeEach('a');
    expect(editor.textContent).toBe('15');
    expect(caretAt(editor)).toBe(1);

    // The next accepted character therefore lands where the user was typing.
    typeEach('9');
    expect(editor.textContent).toBe('195');
    expect(caretAt(editor)).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // IME: the rewrite must not tear down a live composition
  // ---------------------------------------------------------------------------

  function composingInput(el: HTMLElement) {
    const event = new Event('input', { bubbles: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    el.dispatchEvent(event);
    h.fixture.detectChanges();
  }

  it('leaves a composition alone while it is in flight', async () => {
    await open();

    const editor = h.editor()!;
    editor.textContent = '1a';
    setCaretOffset(editor, 2);

    composingInput(editor);

    // Untouched: rewriting here would abort the IME mid-composition.
    expect(editor.textContent).toBe('1a');
  });

  it('filters once the composition commits', async () => {
    await open();

    const editor = h.editor()!;
    editor.textContent = '1a';
    setCaretOffset(editor, 2);

    composingInput(editor);
    editor.dispatchEvent(new Event('compositionend', { bubbles: true }));
    h.fixture.detectChanges();

    expect(editor.textContent).toBe('1');
    expect(h.host.value()).toBe('1');
  });

  it('keeps streaming mid-composition when no filter is set', async () => {
    h.host.allowed.set(undefined);
    h.fixture.detectChanges();

    await elevate(h);

    const editor = h.editor()!;
    editor.textContent = 'compos';
    setCaretOffset(editor, 6);

    composingInput(editor);

    // The guard is gated on the filter: unfiltered fields must not regress to
    // withholding the draft until the IME commits.
    expect(h.host.value()).toBe('compos');
  });

  // ---------------------------------------------------------------------------
  // Paste on the resting display
  // ---------------------------------------------------------------------------

  function pasteOnDisplay(text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    h.display().dispatchEvent(event);
    h.fixture.detectChanges();
  }

  it('does NOT elevate when a paste is entirely illegal', () => {
    pasteOnDisplay('N/A');

    expect(h.editable().editing()).toBe(false);
    expect(h.host.value()).toBe('');
  });

  it('elevates with the surviving characters when a paste is partly legal', async () => {
    pasteOnDisplay('a1b2');
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.editable().editing()).toBe(true);
    expect(h.host.value()).toBe('12');
  });
});

describe('AngularInlineText — single-line newline strip', () => {
  let h: Harness<FilteredHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FilteredHost] });
    h = setup(FilteredHost);
    h.host.allowed.set(undefined);
    h.fixture.detectChanges();
  });

  it('restores the caret after collapsing pasted line breaks', async () => {
    await elevate(h);

    const editor = h.editor()!;
    editor.textContent = 'a\nb';
    setCaretOffset(editor, 3);

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('a b');
    // The rewrite used to drop the caret entirely.
    expect(getSelectionOffsets(editor)?.start).toBe(3);
  });
});
