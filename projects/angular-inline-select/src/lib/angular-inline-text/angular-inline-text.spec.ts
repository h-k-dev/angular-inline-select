import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, type ValidationError } from '@angular/forms/signals';

import { AngularInlineText, normalizeString, type InlineTextSaved } from './angular-inline-text';
import { EditableSuffix } from './editable-affix';
import { detectSlashToken } from './editable-menu';
import { replayEdit } from './caret';

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

  saved: string[] = [];
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
    expect(h.host.saved).toEqual(['new   value \n here']);
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
    expect(h.host.saved).toEqual(['']);
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
