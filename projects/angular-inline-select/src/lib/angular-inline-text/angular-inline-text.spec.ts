import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, type ValidationError } from '@angular/forms/signals';

import {
  AngularInlineText,
  normalizeString,
  type InlineTextSaved,
  type InlineTextWrapBehavior,
} from './angular-inline-text';
import { EditableSuffix } from './editable-affix';
import { EditableClear, EditableClearTemplate } from '../bubble-menu/editable-clear';
import { EditableAction, EditableActionsTemplate } from '../bubble-menu/editable-actions';
import { detectSlashToken } from './editable-menu';
import {
  EDITABLE_PANEL_ACTIONS_CONTEXT,
  EditablePanelActionsTemplate,
  provideEditablePanelActions,
} from './editable-panel-actions';
import { EditableTextIntl } from './editable-text-intl';
import {
  replayEdit,
  filterChars,
  getSelectionOffsets,
  setCaretOffset,
  alignCaret,
  caretOffsetNearPoint,
} from './caret';

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

@Component({
  imports: [AngularInlineText, EditableClear, EditableClearTemplate],
  template: `
    <angular-inline-text
      [(value)]="value"
      [showClear]="showClear()"
      (saved)="sessions.push($event)"
      (touch)="touchCount = touchCount + 1"
    >
      <ng-template editableClear let-clear let-label="label" let-side="side" let-focus="focus">
        <button
          editableClear
          class="confirm-clear"
          [attr.aria-label]="label"
          [attr.data-side]="side"
          (clear)="request(clear, focus)"
        >
          ✕
        </button>
      </ng-template>
    </angular-inline-text>
  `,
})
class ConfirmClearHost {
  value = signal('initial');
  showClear = signal(true);
  sessions: InlineTextSaved[] = [];
  touchCount = 0;

  /** Stands in for a confirmation dialog: capture the callbacks, resolve later. */
  pending: (() => void) | null = null;
  restoreFocus: (() => void) | null = null;

  request(clear: () => void, focus: () => void) {
    this.pending = clear;
    this.restoreFocus = focus;
  }
}

// =============================================================================
// Helpers
// =============================================================================

@Component({
  imports: [AngularInlineText],
  template: `
    <angular-inline-text
      [(value)]="value"
      [draftText]="toDraft"
      [isSingleLine]="true"
      (saved)="sessions.push($event)"
    />
  `,
})
class DraftTextHost {
  /** The display is a grouped rendering; the editor works on the digits. */
  value = signal('1.250.000,50');
  toDraft = (committed: string) => committed.replace(/\./g, '');
  sessions: InlineTextSaved[] = [];
}

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

/** Hovers the field so the clear bubble (a CDK overlay) renders. */
function hoverField(h: Harness<unknown>) {
  h.display().closest('.editable-text__field')!.dispatchEvent(new MouseEvent('mouseenter'));
  h.fixture.detectChanges();
}

/** Un-hovers and waits out the bubble's grace timer, as a real pointer would. */
async function leaveField(h: Harness<unknown>) {
  h.display().closest('.editable-text__field')!.dispatchEvent(new MouseEvent('mouseleave'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  h.fixture.detectChanges();
}

function bubbleAction(selector: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.editable-bubble ${selector}`);
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
    // An EMPTY invalid value (the pristine `required` case): nothing was
    // injected, so only the field's touched status reveals the error.
    h.host.value.set('');
    h.host.errors.set([{ kind: 'required' }]);
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

  describe('an injected invalid value (a backend mistake)', () => {
    const invalidClass = () =>
      (
        h.fixture.nativeElement.querySelector('angular-inline-text') as HTMLElement
      ).classList.contains('editable-text--invalid');

    beforeEach(() => {
      // An occupied value the form rejects, untouched — it can only have
      // been injected: `accept()` never commits an invalid draft.
      h.host.errors.set([{ kind: 'email' }]);
      h.fixture.detectChanges();
    });

    it('wears the error state on arrival, untouched, and keeps aria-invalid', () => {
      expect(h.host.touched()).toBe(false);
      expect(invalidClass()).toBe(true);
      expect(h.display().getAttribute('aria-invalid')).toBe('true');
    });

    it('does not forge the touched status', () => {
      expect(h.host.touchCount).toBe(0);
    });

    it('leaves the error at the door of a session until the session is touched', async () => {
      // Opening the editor is not a mistake yet — and neither is typing
      h.editable().editing.set(true);
      h.fixture.detectChanges();
      expect(invalidClass()).toBe(false);

      await typeText(h, 'typing');
      expect(invalidClass()).toBe(false);

      // Still invalid per the bound errors: the attempt reveals them
      accept(h);
      expect(h.editable().editing()).toBe(true);
      expect(invalidClass()).toBe(true);
    });

    it('wears the error state again when a discard restores the injected value', async () => {
      await typeText(h, 'typing');

      cancel(h);

      expect(h.host.value()).toBe('initial');
      expect(invalidClass()).toBe(true);
    });

    it('lifts the error state once the value is repaired', () => {
      h.host.errors.set([]);
      h.fixture.detectChanges();

      expect(invalidClass()).toBe(false);
    });
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

    // Typing never reveals: the session is untouched
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

  it('a pointer inside the panel is the session touch and reveals the errors', async () => {
    h.host.errors.set([{ kind: 'server', message: 'Taken' }]);
    h.fixture.detectChanges();

    await typeText(h, 'invalid attempt');
    expect(document.querySelector('.editable-panel__message--error')).toBeNull();

    document
      .querySelector('.editable-panel')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    h.fixture.detectChanges();

    expect(document.querySelector('.editable-panel__message--error')?.textContent?.trim()).toBe(
      'Taken',
    );
    // A session touch is not a field touch
    expect(h.host.touchCount).toBe(0);
  });

  it('session state starts fresh: a touched field opens a quiet session', async () => {
    h.host.errors.set([{ kind: 'server', message: 'Taken' }]);
    h.host.touched.set(true);
    h.fixture.detectChanges();

    // Idle: touched + invalid = shown
    const host = h.fixture.nativeElement.querySelector('angular-inline-text') as HTMLElement;
    expect(host.classList.contains('editable-text--invalid')).toBe(true);

    // Open and type: nothing of the user's to complain about yet
    await typeText(h, 'still invalid');

    expect(host.classList.contains('editable-text--invalid')).toBe(false);
    expect(document.querySelector('.editable-panel__message--error')).toBeNull();

    // A refused save reveals; the next session starts quiet again
    accept(h);
    expect(document.querySelector('.editable-panel__message--error')).not.toBeNull();

    cancel(h);
    await typeText(h, 'still invalid');
    expect(document.querySelector('.editable-panel__message--error')).toBeNull();
  });

  it('the session touch resets on an EXTERNAL open too — linked to editing, no reset site', async () => {
    h.host.errors.set([{ kind: 'server', message: 'Taken' }]);
    h.fixture.detectChanges();

    await typeText(h, 'still invalid');
    accept(h);
    expect(document.querySelector('.editable-panel__message--error')).not.toBeNull();
    cancel(h);

    // The phone flag picker's path: nobody calls `elevate()`, the session
    // opens by a write to the `editing` model. The touch is still spent.
    h.editable().editing.set(true);
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(document.querySelector('.editable-panel__message--error')).toBeNull();
    expect(
      (
        h.fixture.nativeElement.querySelector('angular-inline-text') as HTMLElement
      ).classList.contains('editable-text--invalid'),
    ).toBe(false);
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
    const inPanel = document.querySelector(
      '.editable-panel__line .editable-text__affix--suffix .unit',
    );
    expect(inPanel?.textContent).toBe('kg');
    expect(h.editor()?.contains(inPanel!)).toBe(false);
  });

  it('the affix is decorative: aria-hidden and not in the committed value', async () => {
    const affix = h.fixture.nativeElement.querySelector(
      '.editable-text__affix--suffix',
    ) as HTMLElement;
    expect(affix.getAttribute('aria-hidden')).toBe('true');

    await typeText(h, '25');
    (h.editable() as unknown as { accept(): void }).accept();
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('25');
  });
});

describe('AngularInlineText — clear affordance', () => {
  it('showClear false never offers the bubble, template or not — emptying stays the long way', () => {
    const h = setup(ConfirmClearHost);
    h.host.showClear.set(false);
    h.fixture.detectChanges();

    hoverField(h);
    expect(document.querySelector('.editable-bubble')).toBeNull();
    expect(bubbleAction('button.confirm-clear')).toBeNull();

    h.host.showClear.set(true);
    h.fixture.detectChanges();
    hoverField(h);
    expect(bubbleAction('button.confirm-clear')).not.toBeNull();
  });

  it('renders the stock button, which clears on click', () => {
    const h = setup(ValueBindingHost);
    hoverField(h);

    const stock = bubbleAction('button.editable-action-clear');
    expect(stock).not.toBeNull();
    expect(stock!.getAttribute('aria-label')).toBe('Clear value');

    stock!.dispatchEvent(new MouseEvent('click'));
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('');
    expect(h.host.sessions).toEqual([{ value: '', changed: true }]);
  });

  it('an editableClear template takes the slot over entirely', () => {
    const h = setup(ConfirmClearHost);
    hoverField(h);

    const custom = bubbleAction('button.confirm-clear');
    expect(custom).not.toBeNull();
    expect(bubbleAction('button.editable-action-clear')).toBeNull();

    // The context labels the button for free; a single-value field has no side.
    expect(custom!.getAttribute('aria-label')).toBe('Clear value');
    expect(custom!.getAttribute('data-side')).toBeNull();
  });

  it("hands the commit over: the consumer's click alone changes nothing", () => {
    const h = setup(ConfirmClearHost);
    hoverField(h);

    bubbleAction('button.confirm-clear')!.dispatchEvent(new MouseEvent('click'));
    h.fixture.detectChanges();

    // THE POINT OF THE SEAM: clearing is a commit, so a confirmation that has
    // not happened yet must not have reached the bound value, the field's
    // touched state, or a consumer's persist path.
    expect(h.host.value()).toBe('initial');
    expect(h.host.sessions).toEqual([]);
    expect(h.host.touchCount).toBe(0);
    expect(typeof h.host.pending).toBe('function');
  });

  it('the captured callback still clears after the bubble is gone (the dialog case)', async () => {
    const h = setup(ConfirmClearHost);
    hoverField(h);

    bubbleAction('button.confirm-clear')!.dispatchEvent(new MouseEvent('click'));
    h.fixture.detectChanges();

    // A modal takes the pointer away: the hover bubble — and the consumer's
    // own button with it — is torn down while the dialog is open.
    await leaveField(h);
    expect(bubbleAction('button.confirm-clear')).toBeNull();

    h.host.pending!();
    h.fixture.detectChanges();

    expect(h.host.value()).toBe('');
    expect(h.host.sessions).toEqual([{ value: '', changed: true }]);
    expect(h.host.touchCount).toBe(1);
  });

  it('the context restores focus to the field a dismissed bubble took away', async () => {
    const h = setup(ConfirmClearHost);
    hoverField(h);

    bubbleAction('button.confirm-clear')!.dispatchEvent(new MouseEvent('click'));
    h.fixture.detectChanges();
    await leaveField(h);

    // The modal's own restore-focus has nowhere to land — the button it would
    // restore to died with the bubble. The context puts it back on the field.
    h.host.restoreFocus!();
    expect(document.activeElement).toBe(h.display());
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

    // Untouched session: the whole slot stays hidden, projection included
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

describe('alignCaret', () => {
  it('carries a caret across removed characters', () => {
    // 1.250.000,50 → 1250000,50: caret after "1.250." lands after "1250".
    expect(alignCaret('1.250.000,50', '1250000,50', 6)).toBe(4);
    expect(alignCaret('1.250.000,50', '1250000,50', 0)).toBe(0);
    expect(alignCaret('1.250.000,50', '1250000,50', 12)).toBe(10);
  });

  it('clamps to the draft when the source runs longer', () => {
    expect(alignCaret('1.250.000,50', '1250000,5', 12)).toBe(9);
    expect(alignCaret('abc', 'abc', 99)).toBe(3);
  });

  it('is the identity when both texts are the same', () => {
    expect(alignCaret('hello', 'hello', 3)).toBe(3);
  });
});

describe('AngularInlineText — draftText (a rendering the editor does not type around)', () => {
  let h: Harness<DraftTextHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DraftTextHost] });
    h = setup(DraftTextHost);
  });

  it('opens the editor on the draft while the display keeps its rendering', async () => {
    await elevate(h);

    // The seed keystroke ('x') lands at the end of the DRAFT, not the display text.
    expect(h.editor()?.textContent).toBe('1250000,50x');
    expect(h.display().textContent).toBe('1.250.000,50');
  });

  it('an unchanged save restores the rendering instead of committing the draft', async () => {
    await typeText(h, '1250000,50');
    accept(h);

    expect(h.host.value()).toBe('1.250.000,50');
    expect(h.host.sessions.at(-1)).toEqual({ value: '1.250.000,50', changed: false });
  });

  it('a changed draft commits as typed — the parent renders it back', async () => {
    await typeText(h, '2500,75');
    accept(h);

    expect(h.host.value()).toBe('2500,75');
    expect(h.host.sessions.at(-1)?.changed).toBe(true);
  });

  it('discard rolls back to the rendering', async () => {
    await typeText(h, '999');
    cancel(h);

    expect(h.host.value()).toBe('1.250.000,50');
    expect(h.display().textContent).toBe('1.250.000,50');
  });
});

// =============================================================================
// The interactive unit — the halo around the text is the hover, press and
// focus target (a native input's box, restored)
// =============================================================================

describe('caretOffsetNearPoint', () => {
  type Rect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
  const rect = (left: number, top: number, width: number, height: number): Rect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });

  function textRoot(text: string, rects: Rect[]) {
    const root = document.createElement('span');
    root.textContent = text;
    document.body.appendChild(root);
    root.getClientRects = () => rects as unknown as DOMRectList;
    return root;
  }

  afterEach(() => {
    delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
    delete (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
  });

  it('without layout (no line boxes) the caret goes to the end', () => {
    const root = textRoot('hello', []);
    expect(caretOffsetNearPoint(root, 0, 0)).toBe(5);
  });

  it('clamps the point into the nearest line and asks the browser for the character there', () => {
    const root = textRoot('hello world', [rect(100, 10, 80, 20), rect(100, 30, 40, 20)]);
    const seen: [number, number][] = [];
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = (
      x: number,
      y: number,
    ) => {
      seen.push([x, y]);
      const range = document.createRange();
      range.setStart(root.firstChild!, 3);
      return range;
    };

    // A press in the halo ABOVE the first line, past its end: clamped to the
    // first line's inline-end edge at its vertical centre.
    expect(caretOffsetNearPoint(root, 500, 2)).toBe(3);
    expect(seen).toEqual([[179, 20]]);
  });

  it('a hit outside the root falls back to the nearest edge', () => {
    const root = textRoot('hello', [rect(100, 10, 80, 20)]);
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(document.body, 0);
      return range;
    };

    expect(caretOffsetNearPoint(root, 10, 20)).toBe(0); // before the first line
    expect(caretOffsetNearPoint(root, 300, 20)).toBe(5); // past it
  });

  it('without the hit-testing API: start before the first line, end anywhere else', () => {
    const root = textRoot('hello', [rect(100, 10, 80, 20), rect(100, 30, 40, 20)]);

    expect(caretOffsetNearPoint(root, 10, 20)).toBe(0);
    expect(caretOffsetNearPoint(root, 10, 40)).toBe(5); // before the SECOND line: no offset known
    expect(caretOffsetNearPoint(root, 300, 20)).toBe(5);
  });
});

@Component({
  imports: [AngularInlineText, EditableSuffix],
  template: `
    <angular-inline-text [(value)]="value" [disabled]="disabled()">
      <ng-template editableSuffix>
        <span class="unit">€</span>
        <button type="button" class="chrome" (mousedown)="chromePressed = chromePressed + 1">
          i
        </button>
      </ng-template>
    </angular-inline-text>
  `,
})
class UnitHost {
  value = signal('initial');
  disabled = signal(false);
  chromePressed = 0;
}

describe('AngularInlineText — the interactive unit', () => {
  let h: Harness<UnitHost>;

  const field = () => h.fixture.nativeElement.querySelector('.editable-text__field') as HTMLElement;

  function press(target: Element, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    target.dispatchEvent(event);
    h.fixture.detectChanges();
    return event;
  }

  beforeEach(() => {
    h = setup(UnitHost);
  });

  it('a press in the halo focuses the text with the caret at the nearest character', () => {
    const event = press(field(), { clientX: 400, clientY: 8 });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(h.display());
    // jsdom has no layout: the nearest character is the end
    expect(getSelectionOffsets(h.display())).toEqual({ start: 7, end: 7 });
  });

  it('a press in the halo BEFORE the text lands at the start', () => {
    h.display().getClientRects = () =>
      [
        { left: 100, right: 180, top: 10, bottom: 30, width: 80, height: 20 },
      ] as unknown as DOMRectList;

    press(field(), { clientX: 10, clientY: 20 });

    expect(document.activeElement).toBe(h.display());
    expect(getSelectionOffsets(h.display())).toEqual({ start: 0, end: 0 });
  });

  it('a press on a non-interactive affix counts as the halo', () => {
    press(h.fixture.nativeElement.querySelector('.unit'), { clientX: 400, clientY: 8 });

    expect(document.activeElement).toBe(h.display());
  });

  it('presses on the text itself, on chrome, with shift, or on a locked field are left alone', () => {
    expect(press(h.display()).defaultPrevented).toBe(false);

    expect(press(h.fixture.nativeElement.querySelector('.chrome')).defaultPrevented).toBe(false);
    expect(h.host.chromePressed).toBe(1);

    expect(press(field(), { shiftKey: true }).defaultPrevented).toBe(false);

    h.host.disabled.set(true);
    h.fixture.detectChanges();
    expect(press(field()).defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(h.display());
  });

  it('a press never opens the session — the first keystroke still does', async () => {
    press(field(), { clientX: 400, clientY: 8 });
    expect(h.editable().editing()).toBe(false);

    await typeText(h, 'typed');
    expect(h.editable().editing()).toBe(true);

    // While the panel is open the dimmed unit ignores presses (the scrim owns them)
    expect(press(field()).defaultPrevented).toBe(false);
  });
});

// =============================================================================
// The primary-actions slot — consumer buttons that act ON the value, before
// clear, with their own gate
// =============================================================================

@Component({
  imports: [AngularInlineText, EditableActionsTemplate, EditableAction],
  template: `
    <angular-inline-text [(value)]="value" [readonly]="readonly()" [showClear]="showClear()">
      <ng-template editableActions let-data let-focus="focus">
        <a editableAction class="open" [href]="data.value">go</a>
      </ng-template>
    </angular-inline-text>
  `,
})
class ActionsHost {
  value = signal('https://example.test/');
  readonly = signal(false);
  showClear = signal(true);
}

describe('AngularInlineText — primary actions', () => {
  let h: Harness<ActionsHost>;

  const open = () => document.querySelector<HTMLAnchorElement>('.editable-bubble .open');
  const clear = () => document.querySelector('.editable-bubble .editable-action-clear');
  const groups = () => [...document.querySelectorAll('.editable-bubble .editable-bubble__group')];

  beforeEach(() => {
    h = setup(ActionsHost);
  });

  it('stamps the consumer template with the payload, BEFORE the clear button', () => {
    hoverField(h);

    expect(open()?.getAttribute('href')).toBe('https://example.test/');
    expect(clear()).not.toBeNull();
    expect(groups().map((g) => g.className)).toEqual([
      'editable-bubble__group editable-bubble__actions',
      'editable-bubble__group editable-bubble__clear',
    ]);
  });

  it('gates are per slot: a readonly field keeps its actions and loses clear', () => {
    h.host.readonly.set(true);
    h.fixture.detectChanges();
    hoverField(h);

    expect(open()).not.toBeNull();
    expect(clear()).toBeNull();
    expect(groups().length).toBe(1);
  });

  it('showClear false keeps the actions', () => {
    h.host.showClear.set(false);
    h.fixture.detectChanges();
    hoverField(h);

    expect(open()).not.toBeNull();
    expect(clear()).toBeNull();
  });

  it('an empty value offers nothing to act on', () => {
    h.host.value.set('');
    h.fixture.detectChanges();
    hoverField(h);

    expect(document.querySelector('.editable-bubble')).toBeNull();
  });

  it('a press on an action never moves focus off the field', () => {
    hoverField(h);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    open()!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

// =============================================================================
// Panel keys reach the panel from its action buttons
//
// Escape (revert), Ctrl+Enter (save) and Tab (scope handover) are the PANEL's
// keys — they must work wherever focus sits inside it, the action buttons
// included. A button that swallows keydown strands the user on it.
// =============================================================================

describe('AngularInlineText — panel keys from the action buttons', () => {
  let h: Harness<ValueBindingHost>;

  beforeEach(() => {
    h = setup(ValueBindingHost);
  });

  function actionButtons(): HTMLButtonElement[] {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.editable-panel .editable-panel__actions button',
      ),
    );
  }

  function keydown(target: Element, init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    h.fixture.detectChanges();
    return event;
  }

  it('Escape on an action button reverts the session', async () => {
    await typeText(h, 'draft');
    const [discard, save] = actionButtons();
    expect(discard).toBeTruthy();
    expect(save).toBeTruthy();

    save.focus();
    keydown(save, { key: 'Escape' });
    await h.fixture.whenStable();

    expect(h.editable().editing()).toBe(false);
    expect(h.host.value()).toBe('initial');
    expect(h.host.saved).toEqual([]);
  });

  it('Ctrl+Enter on an action button saves the session', async () => {
    await typeText(h, 'draft');
    const [discard] = actionButtons();

    discard.focus();
    keydown(discard, { key: 'Enter', ctrlKey: true });
    await h.fixture.whenStable();

    expect(h.editable().editing()).toBe(false);
    expect(h.host.value()).toBe('draft');
    expect(h.host.saved).toEqual([{ value: 'draft' }]);
  });

  it('Cmd+Enter (macOS) saves the session exactly like Ctrl+Enter', async () => {
    await typeText(h, 'draft');
    const [discard] = actionButtons();

    discard.focus();
    keydown(discard, { key: 'Enter', metaKey: true });
    await h.fixture.whenStable();

    expect(h.editable().editing()).toBe(false);
    expect(h.host.value()).toBe('draft');
    expect(h.host.saved).toEqual([{ value: 'draft' }]);
  });

  it('Tab on an action button reaches the panel (its scope handover), not swallowed', async () => {
    await typeText(h, 'draft');
    const [, save] = actionButtons();
    const panel = document.querySelector('.editable-panel')!;

    const heard: string[] = [];
    panel.addEventListener('keydown', (event) => heard.push((event as KeyboardEvent).key));

    save.focus();
    keydown(save, { key: 'Tab' });
    keydown(save, { key: 'Tab', shiftKey: true });
    expect(heard).toEqual(['Tab', 'Tab']);
  });
});

// =============================================================================
// The panel-actions SLOT — stock buttons, an app-wide renderer, a per-field
// template. Whatever renders, the control keeps the contract: keys reach the
// panel, a press never steals focus from the editor, the verbs work.
// =============================================================================

@Component({
  selector: 'custom-panel-actions',
  template: `
    <button type="button" class="custom-cancel" (click)="context.cancel()">No</button>
    <button
      type="button"
      class="custom-accept"
      [attr.data-dirty]="context.dirty()"
      (click)="context.accept()"
    >
      Yes
    </button>
  `,
})
class CustomPanelActions {
  protected readonly context = inject(EDITABLE_PANEL_ACTIONS_CONTEXT);
}

@Component({
  imports: [AngularInlineText, EditablePanelActionsTemplate],
  template: `
    <angular-inline-text [(value)]="value" (savedModelChange)="saved.push($event)">
      <ng-template editablePanelActions let-actions>
        <button type="button" class="per-field-apply" (click)="actions.accept()">Apply</button>
      </ng-template>
    </angular-inline-text>
  `,
})
class PanelActionsTemplateHost {
  value = signal('initial');
  saved: { value: string }[] = [];
}

describe('AngularInlineText — the panel-actions slot', () => {
  const actions = () =>
    document.querySelector('.editable-panel .editable-panel__actions') as HTMLElement | null;

  function keydown(target: Element, init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('renders the stock buttons by default, labelled through EditableTextIntl', async () => {
    const h = setup(ValueBindingHost);
    await typeText(h, 'draft');

    const buttons = Array.from(actions()!.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Discard', 'Save']);
    expect(document.querySelector('.editable-panel__message--hint')?.textContent?.trim()).toBe(
      'Unsaved changes',
    );

    const intl = TestBed.inject(EditableTextIntl);
    intl.saveLabel.set('Speichern');
    intl.unsavedChangesLabel.set('Ungespeicherte Änderungen');
    h.fixture.detectChanges();

    expect(buttons[1].textContent?.trim()).toBe('Speichern');
    expect(document.querySelector('.editable-panel__message--hint')?.textContent?.trim()).toBe(
      'Ungespeicherte Änderungen',
    );
  });

  describe('an app-wide renderer (provideEditablePanelActions)', () => {
    let h: Harness<ValueBindingHost>;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideEditablePanelActions(CustomPanelActions)],
      });
      h = setup(ValueBindingHost);
    });

    it('replaces the stock buttons and receives the session context', async () => {
      await typeText(h, 'draft');

      expect(actions()!.querySelector('.editable-action-save')).toBeNull();
      const accept = actions()!.querySelector('.custom-accept') as HTMLButtonElement;
      expect(accept.getAttribute('data-dirty')).toBe('true');

      accept.click();
      h.fixture.detectChanges();
      await h.fixture.whenStable();

      expect(h.editable().editing()).toBe(false);
      expect(h.host.value()).toBe('draft');
      expect(h.host.saved).toEqual([{ value: 'draft' }]);
    });

    it("its keys stay the panel's — Escape from its button reverts", async () => {
      await typeText(h, 'draft');
      const accept = actions()!.querySelector('.custom-accept') as HTMLButtonElement;

      accept.focus();
      keydown(accept, { key: 'Escape' });
      h.fixture.detectChanges();
      await h.fixture.whenStable();

      expect(h.editable().editing()).toBe(false);
      expect(h.host.value()).toBe('initial');
    });

    it('a press never steals focus from the editor — the slot container prevents mousedown', async () => {
      await typeText(h, 'draft');
      const cancel = actions()!.querySelector('.custom-cancel') as HTMLButtonElement;

      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      cancel.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
    });
  });

  it('a per-field [editablePanelActions] template wins over the DI renderer', async () => {
    TestBed.configureTestingModule({
      providers: [provideEditablePanelActions(CustomPanelActions)],
    });
    const h = setup(PanelActionsTemplateHost);
    await typeText(h, 'draft');

    expect(actions()!.querySelector('.custom-accept')).toBeNull();
    (actions()!.querySelector('.per-field-apply') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    await h.fixture.whenStable();

    expect(h.host.value()).toBe('draft');
    expect(h.host.saved).toEqual([{ value: 'draft' }]);
  });
});

// =============================================================================
// Keyboard focus paints a caret — the display is a live text box, not a label
// =============================================================================

describe('AngularInlineText — keyboard focus places a caret', () => {
  // The `focus` event is dispatched rather than calling `focus()`: jsdom's
  // `focus()` on a contenteditable collapses the selection to offset 0 before
  // the event runs (a real browser does not), which would mask both cases.
  function focusEvent(el: HTMLElement) {
    el.dispatchEvent(new FocusEvent('focus'));
  }

  it('keyboard / programmatic focus (no selection inside) puts the caret at the end of the text', () => {
    const h = setup(ValueBindingHost);
    const display = h.display();

    document.getSelection()?.removeAllRanges();
    focusEvent(display);

    expect(getSelectionOffsets(display)).toEqual({
      start: 'initial'.length,
      end: 'initial'.length,
    });
  });

  it('a focus that already carries a caret (a click) keeps it where it landed', () => {
    const h = setup(ValueBindingHost);
    const display = h.display();

    setCaretOffset(display, 2);
    focusEvent(display);

    expect(getSelectionOffsets(display)).toEqual({ start: 2, end: 2 });
  });
});
