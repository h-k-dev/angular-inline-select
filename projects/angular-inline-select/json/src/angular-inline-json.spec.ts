import { ApplicationRef, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EditorView } from '@codemirror/view';

import { AngularInlineText, EditableScope } from 'angular-inline-select';

import { AngularInlineJson, type InlineJsonSaved } from './angular-inline-json';

@Component({
  imports: [AngularInlineJson],
  template: `
    <angular-inline-json
      [(value)]="value"
      [(editing)]="editing"
      [disabled]="disabled()"
      (savedModelChange)="saved.push($event)"
      (saved)="sessions.push($event)"
      (touch)="touchCount = touchCount + 1"
    />
  `,
})
class ValueBindingHost {
  value = signal('');
  editing = signal(false);
  disabled = signal(false);

  saved: { value: string }[] = [];
  sessions: InlineJsonSaved[] = [];
  touchCount = 0;
}

function setup() {
  TestBed.configureTestingModule({ imports: [ValueBindingHost] });
  const fixture: ComponentFixture<ValueBindingHost> = TestBed.createComponent(ValueBindingHost);
  fixture.detectChanges();

  return { fixture, host: fixture.componentInstance };
}

/**
 * Renders pending work: the fixture, the ApplicationRef-attached overlay
 * views, and a macrotask hop for the untracked `await import(…)` boundary.
 */
async function settle(fixture: ComponentFixture<ValueBindingHost>) {
  fixture.detectChanges();
  TestBed.inject(ApplicationRef).tick();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  TestBed.inject(ApplicationRef).tick();
}

/** Opens the session dialog (lazy import + CM mount) and waits until the editor exists. */
async function openSession(fixture: ComponentFixture<ValueBindingHost>) {
  const display = fixture.nativeElement.querySelector('.editable-json__display') as HTMLElement;
  display.click();

  for (let i = 0; i < 20 && document.querySelector('.cm-editor') === null; i++) {
    await settle(fixture);
  }
  if (document.querySelector('.cm-editor') === null) throw new Error('session never mounted');
}

/** The mounted CodeMirror view — the session's source of truth for the draft. */
function editorView(): EditorView {
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no EditorView mounted');
  return view;
}

/** Replaces the whole editor document, as typing would. */
function typeDraft(fixture: ComponentFixture<ValueBindingHost>, text: string) {
  const view = editorView();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  fixture.detectChanges();
}

describe('AngularInlineJson', () => {
  it('creates and starts idle', () => {
    const { host } = setup();
    expect(host.editing()).toBe(false);
  });

  it('shows the placeholder when empty', () => {
    const { fixture } = setup();
    const placeholder = fixture.nativeElement.querySelector('.editable-json__placeholder');
    expect(placeholder?.textContent?.trim()).toBe('null');
  });

  it('renders a small committed value whole, flowing as its compact text', () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1,"b":2}');
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.editable-json__preview');
    expect(preview?.textContent).toBe('{"a":1,"b":2}');
    expect(preview?.textContent).not.toContain('⋯');
  });

  it('middle-ellipses a huge value — real head, real tail, bounded output', () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) huge[`key${i}`] = i;

    const { fixture, host } = setup();
    host.value.set(JSON.stringify(huge));
    fixture.detectChanges();

    const text = fixture.nativeElement.querySelector('.editable-json__preview')?.textContent ?? '';
    expect(text).toContain('⋯');
    expect(text.startsWith('{"key0":0')).toBe(true);
    expect(text.endsWith('"key4999":4999}')).toBe(true);
    expect(text.length).toBeLessThan(1000); // bounded, never the whole document
  });

  it('opens the session dialog lazily on click and mounts CodeMirror seeded with the editing form', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);

    expect(host.editing()).toBe(true);
    expect(document.querySelector('.editable-dialog')).toBeTruthy();
    expect(editorView().state.doc.toString()).toBe('{\n  a: 1\n}'); // pretty, bare keys
  });

  it('does not elevate when disabled', () => {
    const { fixture, host } = setup();
    host.disabled.set(true);
    fixture.detectChanges();

    const display = fixture.nativeElement.querySelector('.editable-json__display') as HTMLElement;
    display.click();
    fixture.detectChanges();

    expect(host.editing()).toBe(false);
  });

  it('commits a changed, valid draft on Save as canonical strict JSON', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);
    typeDraft(fixture, '{a: 2}');

    (document.querySelector('.editable-action-save') as HTMLElement).click();
    await settle(fixture);

    expect(host.editing()).toBe(false);
    expect(host.value()).toBe('{"a":2}');
    expect(host.saved).toEqual([{ value: '{"a":2}' }]);
    expect(host.sessions).toEqual([{ value: '{"a":2}', changed: true }]);
    expect(host.touchCount).toBe(1); // the closing edge is the blur analogue
    expect(document.querySelector('.editable-dialog')).toBeNull();
  });

  it('commits a bare-key draft as strict double-quoted compact JSON', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);
    typeDraft(fixture, '{role: "admin", tags: [1, 2]}');

    (document.querySelector('.editable-action-save') as HTMLElement).click();
    await settle(fixture);

    expect(host.value()).toBe('{"role":"admin","tags":[1,2]}');
    expect(host.saved).toEqual([{ value: '{"role":"admin","tags":[1,2]}' }]);
  });

  it('blocks Save on invalid JSON (trailing comma), keeps the dialog open, reveals the error', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);
    typeDraft(fixture, '{"a":1,}');

    (document.querySelector('.editable-action-save') as HTMLElement).click();
    await settle(fixture);

    expect(host.editing()).toBe(true);
    expect(host.saved).toEqual([]);
    expect(host.touchCount).toBe(1); // a failed save attempt marks the field touched
    expect(document.querySelector('.editable-dialog')).toBeTruthy();
    expect(document.querySelector('.editable-panel__message--error')).toBeTruthy();
  });

  it('a save with no semantic change restores the baseline text untouched (reformat is not a change)', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1,"b":2}');
    fixture.detectChanges();

    await openSession(fixture);
    // No edits — the editor holds the seeded reformat (pretty, bare keys).

    (document.querySelector('.editable-action-save') as HTMLElement).click();
    await settle(fixture);

    expect(host.editing()).toBe(false);
    expect(host.value()).toBe('{"a":1,"b":2}'); // exactly the pre-session text
    expect(host.saved).toEqual([]); // no changed settlement
    expect(host.sessions).toEqual([{ value: '{"a":1,"b":2}', changed: false }]);
  });

  it('reverts to the baseline on Discard without committing', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);
    typeDraft(fixture, '{"a":999}');

    (document.querySelector('.editable-action-reset') as HTMLElement).click();
    await settle(fixture);

    expect(host.editing()).toBe(false);
    expect(host.value()).toBe('{"a":1}');
    expect(host.sessions).toEqual([{ value: '{"a":1}', changed: false }]);
    expect(host.touchCount).toBe(1); // discard settles the session — touched
  });

  it('destroying the component closes an open session dialog (no orphaned overlay)', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);
    expect(document.querySelector('.editable-dialog')).toBeTruthy();

    fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve));

    expect(document.querySelector('.editable-dialog')).toBeNull();
  });

  it('an external editing.set(false) closes SILENTLY — reverts, no touch, no settle, no focus steal', async () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    await openSession(fixture);
    typeDraft(fixture, '{"a":999}');

    host.editing.set(false); // programmatic — an instruction, not an interaction
    await settle(fixture);

    expect(document.querySelector('.editable-dialog')).toBeNull();
    expect(host.value()).toBe('{"a":1}'); // draft rolled back
    expect(host.touchCount).toBe(0);
    expect(host.sessions).toEqual([]); // no settlement emission (family: the text control's detach path)
    expect(
      (document.activeElement as HTMLElement | null)?.classList?.contains(
        'editable-json__display',
      ) ?? false,
    ).toBe(false);
  });

  it('clicking while selecting preview text does NOT open the session — the preview is real, copyable text', () => {
    const { fixture, host } = setup();
    host.value.set('{"a":1,"b":2}');
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.editable-json__preview') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(preview);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const display = fixture.nativeElement.querySelector('.editable-json__display') as HTMLElement;
    display.click();
    fixture.detectChanges();

    expect(host.editing()).toBe(false);

    selection.removeAllRanges();
    display.click();
    fixture.detectChanges();
    expect(host.editing()).toBe(true); // without a selection the click elevates as before
  });

  it('clears the value via the clear affordance', () => {
    // The clear button lives inside BubbleMenu's hover-gated CDK overlay
    // (only rendered on a real pointer hover, which jsdom never fires) — call
    // the handler the button's (clear) output wires directly, matching the
    // established pattern in angular-inline-text.spec.ts.
    const { fixture, host } = setup();
    host.value.set('{"a":1}');
    fixture.detectChanges();

    const instance = fixture.debugElement.children[0].componentInstance as AngularInlineJson;
    (instance as unknown as { clearValue(event: Event): void }).clearValue(new Event('click'));
    fixture.detectChanges();

    expect(host.value()).toBe('');
    expect(host.saved).toEqual([{ value: '' }]);
    expect(host.touchCount).toBe(1);
  });
});

// =============================================================================
// Tab-to-accept scope integration — the ONE field where "just type" cannot
// start the session, so the scope's edit-advance must open the dialog.
// =============================================================================

describe('AngularInlineJson — inside an [editableScope]', () => {
  @Component({
    imports: [AngularInlineJson, AngularInlineText, EditableScope],
    template: `
      <div editableScope>
        <angular-inline-text class="text" [(value)]="text" [isSingleLine]="true" />
        <angular-inline-json [(value)]="json" [(editing)]="jsonEditing" />
      </div>
    `,
  })
  class ScopedJsonHost {
    text = signal('alpha');
    json = signal('{"a":1}');
    jsonEditing = signal(false);
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it("a Tab-commit lands on the preview and opens the dialog (advanceMode 'edit' default)", async () => {
    const fixture = TestBed.createComponent(ScopedJsonHost);
    fixture.detectChanges();
    const host = fixture.componentInstance;

    // Elevate the TEXT field via an intercepted first edit.
    const display = fixture.nativeElement.querySelector(
      '.text .editable-text__display',
    ) as HTMLElement;
    const edit = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(edit, 'inputType', { value: 'insertText' });
    Object.defineProperty(edit, 'data', { value: 'x' });
    display.dispatchEvent(edit);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const panel = document.querySelector('.editable-panel');
    if (!panel) throw new Error('elevated panel not found');
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    // The text session settled; the JSON session opened without another gesture.
    expect(document.querySelector('.editable-panel')).toBeNull();
    expect(host.jsonEditing()).toBe(true);
  });
});
